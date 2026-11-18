/**
 * The client's whole connection to the game.
 *
 * The server is authoritative: this hook sends intents and renders whatever
 * `state` comes back. It never computes a score, never decides whose turn it is,
 * and never sees an answer list.
 *
 * Reconnection: the server hands back a token on join, which is kept in
 * sessionStorage per room. A refresh rejoins as the same player with the same
 * score rather than appearing as a new one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, GameView, ServerMessage } from "../game/types.ts";

const WS_URL = () => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
};

const tokenKey = (code: string) => `krillion:token:${code.toUpperCase()}`;

export type Status = "idle" | "connecting" | "live" | "closed" | "error";

export interface Game {
  status: Status;
  state: GameView | null;
  error: string | null;
  playerId: string | null;
  /** Join as a player. */
  join(code: string, name: string): void;
  /** Attach as a display only — the host screen. */
  watch(code: string): void;
  send(msg: ClientMessage): void;
  leave(): void;
}

export function useGame(): Game {
  const [status, setStatus] = useState<Status>("idle");
  const [state, setState] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  /** Replayed on every (re)connect so a dropped socket resumes itself. */
  const intent = useRef<ClientMessage | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const alive = useRef(true);

  // StrictMode mounts, unmounts and remounts in development. `alive` must be
  // re-armed on every mount or the second pass leaves it false for good and
  // connect() silently does nothing.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (retry.current) clearTimeout(retry.current);
      socket.current?.close();
    };
  }, []);

  const connect = useCallback(() => {
    if (!intent.current || !alive.current) return;
    setStatus("connecting");

    const ws = new WebSocket(WS_URL());
    socket.current = ws;

    ws.onopen = () => {
      attempts.current = 0;
      setStatus("live");
      const first = intent.current;
      if (!first) return;
      // Re-send the join with any token we already hold for this room.
      if (first.type === "join") {
        const saved = sessionStorage.getItem(tokenKey(first.code)) ?? undefined;
        ws.send(JSON.stringify({ ...first, ...(saved ? { token: saved } : {}) }));
      } else {
        ws.send(JSON.stringify(first));
      }
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }

      if (msg.type === "state") { setState(msg.state); setError(null); return; }
      if (msg.type === "joined") {
        setPlayerId(msg.playerId);
        if (intent.current?.type === "join") {
          try { sessionStorage.setItem(tokenKey(intent.current.code), msg.token); } catch { /* private mode */ }
        }
        return;
      }
      if (msg.type === "error") setError(msg.message);
    };

    ws.onclose = () => {
      if (!alive.current || !intent.current) { setStatus("closed"); return; }
      setStatus("closed");
      // Back off, but stay responsive for the common case of a brief blip.
      const wait = Math.min(8000, 400 * 2 ** attempts.current++);
      retry.current = setTimeout(connect, wait);
    };

    ws.onerror = () => setStatus("error");
  }, []);

  const join = useCallback((code: string, name: string) => {
    intent.current = { type: "join", code: code.toUpperCase().trim(), name: name.trim() };
    connect();
  }, [connect]);

  const watch = useCallback((code: string) => {
    intent.current = { type: "watch", code: code.toUpperCase().trim() };
    connect();
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const leave = useCallback(() => {
    intent.current = null;
    socket.current?.close();
    setState(null);
    setPlayerId(null);
    setStatus("idle");
  }, []);

  return { status, state, error, playerId, join, watch, send, leave };
}

/** Create a room and return its code. */
export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("could not create a room");
  return ((await res.json()) as { code: string }).code;
}

export interface CatchPage {
  promptId: string;
  promptText: string;
  total: number;
  tierCounts: Record<string, number>;
  matched: number;
  offset: number;
  limit: number;
  answers: { answer: string; score: number; tier: string }[];
}

/** One page of a prompt's answers. Only serves once the game is finished. */
export async function fetchCatch(
  code: string,
  promptId: string,
  opts: { tier?: string; q?: string; offset?: number } = {},
): Promise<CatchPage> {
  const p = new URLSearchParams();
  if (opts.tier) p.set("tier", opts.tier);
  if (opts.q) p.set("q", opts.q);
  if (opts.offset) p.set("offset", String(opts.offset));
  const res = await fetch(`/api/rooms/${code}/catch/${promptId}?${p}`);
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "unavailable");
  return (await res.json()) as CatchPage;
}
