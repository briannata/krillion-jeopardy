/**
 * Room runtime: the impure half of the game.
 *
 * Owns the clock, the sockets, and answer matching; the engine owns the rules. The
 * split matters because every timing bug lives here and every rule bug lives there,
 * and only one of the two is testable without a socket.
 *
 * Matching happens here and the result is handed to the engine as plain numbers, so
 * answer lists stay on the server side of the boundary.
 */

import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { Game, type ScoredSubmission } from "../game/engine.ts";
import { BoardGenerationError } from "../game/board.ts";
import type { ServerMessage } from "../game/types.ts";
import type { Catalogue } from "./catalogue.ts";
import type { Tier } from "../../scripts/krillion.ts";

/** Pause between tier batches during the reveal. */
const REVEAL_STEP_MS = 1_800;
/** Beat after the last batch before the board comes back. */
const ROUND_END_MS = 2_500;
/** Rooms with nobody connected are dropped after this long. */
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

export interface Connection {
  socket: WebSocket;
  /** null for a display-only connection (the host screen). */
  playerId: string | null;
}

export class Room {
  readonly game: Game;
  private readonly connections = new Set<Connection>();
  /** token -> playerId, so a refresh rejoins as the same player. */
  private readonly tokens = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  lastActivity = Date.now();

  constructor(readonly code: string, private readonly catalogue: Catalogue) {
    this.game = new Game(code, catalogue.prompts);
  }

  get isEmpty(): boolean {
    return this.connections.size === 0;
  }

  // --- connections ---------------------------------------------------------

  /** Returns the player id, reusing the one behind `token` when it is still valid. */
  join(socket: WebSocket, name: string, token?: string): { playerId: string; token: string } {
    this.lastActivity = Date.now();
    const existingId = token ? this.tokens.get(token) : undefined;
    const playerId = existingId ?? randomUUID();
    const issued = existingId ? token! : randomUUID();

    this.tokens.set(issued, playerId);
    this.game.addPlayer(playerId, name, Date.now());

    // One socket per player: a second tab replaces the first.
    for (const c of this.connections) {
      if (c.playerId === playerId) {
        this.connections.delete(c);
        try { c.socket.close(4001, "replaced by a newer connection"); } catch { /* already gone */ }
      }
    }
    this.connections.add({ socket, playerId });
    this.broadcast();
    return { playerId, token: issued };
  }

  /** Attach a display-only connection: it sees the board but never plays. */
  watch(socket: WebSocket): void {
    this.lastActivity = Date.now();
    this.connections.add({ socket, playerId: null });
    this.send(socket, { type: "state", state: this.game.view(null) });
  }

  leave(socket: WebSocket): void {
    for (const c of [...this.connections]) {
      if (c.socket === socket) {
        this.connections.delete(c);
        if (!c.playerId) continue;
        const stillHere = [...this.connections].some((o) => o.playerId === c.playerId);
        if (!stillHere) this.game.setConnected(c.playerId, false);
      }
    }
    this.lastActivity = Date.now();
    this.broadcast();
  }

  send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  /** Each socket gets its own view, because `you` is private. */
  broadcast(): void {
    for (const c of this.connections) {
      this.send(c.socket, { type: "state", state: this.game.view(c.playerId) });
    }
  }

  // --- actions -------------------------------------------------------------

  start(): void {
    this.lastActivity = Date.now();
    try {
      this.game.start(Date.now());
    } catch (err) {
      if (err instanceof BoardGenerationError) throw err;
      throw err;
    }
    this.broadcast();
  }

  async pick(playerId: string, tileId: string): Promise<void> {
    this.lastActivity = Date.now();
    const tile = this.game.pick(playerId, tileId, Date.now());
    // Warm the matcher now so the first submission isn't waiting on a 100k-row read.
    void this.catalogue.prompt(tile.promptId).catch(() => { /* surfaced at scoring */ });
    this.broadcast();
    this.scheduleAnswerDeadline();
  }

  draft(playerId: string, text: string): void {
    this.game.draft(playerId, text);
    this.lastActivity = Date.now();
    this.broadcast();
  }

  lock(playerId: string): void {
    this.game.lock(playerId, Date.now());
    this.lastActivity = Date.now();
    this.broadcast();
    this.scheduleAnswerDeadline();
  }

  /** Host nudge: skip the wait for the current step. */
  advance(): void {
    this.lastActivity = Date.now();
    if (this.game.phase === "answering") { void this.closeAnswering(); return; }
    if (this.game.phase === "revealing") { this.stepReveal(); return; }
  }

  // --- the clock -----------------------------------------------------------

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private scheduleAnswerDeadline(): void {
    this.clearTimer();
    const round = this.game.round;
    if (!round || this.game.phase !== "answering") return;
    const wait = Math.max(0, round.deadline - Date.now());
    this.timer = setTimeout(() => void this.closeAnswering(), wait);
  }

  /** Timer up (or everyone locked): match every submission and start the reveal. */
  private async closeAnswering(): Promise<void> {
    this.clearTimer();
    if (this.game.phase !== "answering") return;
    const round = this.game.round!;
    const pending = this.game.pendingSubmissions();

    let results: ScoredSubmission[];
    try {
      const { matcher } = await this.catalogue.prompt(round.tile.promptId);
      results = pending.map(({ playerId, text }) => {
        if (!text.trim()) return { playerId, text, points: 0 };
        const m = matcher.match(text);
        return {
          playerId,
          text,
          points: m.score,
          ...(m.answer ? { matchedAnswer: m.answer } : {}),
          ...(m.tier ? { tier: m.tier as Tier } : {}),
        };
      });
    } catch {
      // Data unreadable: score the round zero rather than wedging the room.
      results = pending.map(({ playerId, text }) => ({ playerId, text, points: 0 }));
    }

    // The phase can change while we await; bail if it did.
    if (this.game.phase !== "answering") return;
    this.game.scoreRound(results);
    this.broadcast();
    this.scheduleRevealStep();
  }

  private scheduleRevealStep(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.stepReveal(), REVEAL_STEP_MS);
  }

  private stepReveal(): void {
    this.clearTimer();
    if (this.game.phase !== "revealing") return;

    const more = this.game.advanceReveal();
    this.broadcast();

    if (more) { this.scheduleRevealStep(); return; }
    this.timer = setTimeout(() => {
      if (this.game.phase !== "revealing") return;
      this.game.endRound();
      this.broadcast();
    }, ROUND_END_MS);
  }

  dispose(): void {
    this.clearTimer();
    for (const c of this.connections) {
      try { c.socket.close(1001, "room closed"); } catch { /* already gone */ }
    }
    this.connections.clear();
  }
}

/** Unambiguous room codes: no I/O/0/1, so nobody mistypes them off a TV. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly catalogue: Catalogue) {
    setInterval(() => this.sweep(), 5 * 60 * 1000).unref?.();
  }

  create(): Room {
    let code = this.newCode();
    while (this.rooms.has(code)) code = this.newCode();
    const room = new Room(code, this.catalogue);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private newCode(): string {
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  private sweep(): void {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.isEmpty && room.lastActivity < cutoff) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
