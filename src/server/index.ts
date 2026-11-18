/**
 * HTTP + WebSocket server.
 *
 * HTTP
 *   POST /api/rooms                              create a room, returns its code
 *   GET  /api/rooms/:code                        does this room exist?
 *   GET  /api/rooms/:code/catch/:promptId        paged answer list, AFTER the game
 *   GET  /api/rooms/:code/qr.svg                 join QR for the shared screen
 *   GET  /health
 *
 * WS   /ws                                       all gameplay
 *
 * The Catch endpoint is the only route that serves answer text, and it refuses
 * unless that room's game is `finished`. Without that check it would be a trivial
 * mid-game oracle: fetch the current prompt's list, read off the 100-pointer.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { Catalogue } from "./catalogue.ts";
import { Room, RoomRegistry } from "./room.ts";
import { BoardGenerationError } from "../game/board.ts";
import { GameError } from "../game/engine.ts";
import { normalize } from "../normalize.ts";
import { reachableOrigin } from "./lan.ts";
import type { ClientMessage, ServerMessage } from "../game/types.ts";
import type { Tier } from "../../scripts/krillion.ts";

const PORT = Number(process.env.PORT ?? 8787);
const PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function main() {
  const catalogue = await Catalogue.load();
  const good = catalogue.prompts.filter((p) => p.quality === "good").length;
  console.log(`catalogue: ${catalogue.prompts.length} prompts (${good} board-ready)`);

  const rooms = new RoomRegistry(catalogue);

  // --- HTTP ----------------------------------------------------------------
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (url.pathname === "/health") return json(res, 200, { ok: true, rooms: rooms.size });

      if (req.method === "POST" && url.pathname === "/api/rooms") {
        const room = rooms.create();
        return json(res, 201, { code: room.code });
      }

      // /api/rooms/:code
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
        const room = rooms.get(parts[2]);
        if (!room) return json(res, 404, { error: "no such room" });

        if (parts.length === 3) {
          return json(res, 200, { code: room.code, phase: room.game.phase });
        }

        // /api/rooms/:code/catch/:promptId
        if (parts[3] === "catch" && parts[4]) {
          return await serveCatch(res, room, parts[4], url, catalogue);
        }

        // /api/rooms/:code/qr.svg
        if (parts[3] === "qr.svg") {
          return await serveJoinQr(res, room.code, url);
        }
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      console.error("http error", err);
      json(res, 500, { error: "internal error" });
    }
  });

  // --- WebSocket -----------------------------------------------------------
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket: WebSocket) => {
    let room: Room | null = null;
    let playerId: string | null = null;

    const fail = (message: string) => {
      const msg: ServerMessage = { type: "error", message };
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    socket.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return fail("malformed message");
      }

      try {
        if (msg.type === "join") {
          const target = rooms.get(msg.code);
          if (!target) return fail("no room with that code");
          const joined = target.join(socket, msg.name, msg.token);
          room = target;
          playerId = joined.playerId;
          socket.send(JSON.stringify({
            type: "joined", playerId: joined.playerId, token: joined.token,
          } satisfies ServerMessage));
          target.send(socket, { type: "state", state: target.game.view(joined.playerId) });
          return;
        }

        if (msg.type === "watch") {
          const target = rooms.get(msg.code);
          if (!target) return fail("no room with that code");
          target.watch(socket);
          room = target;
          return;
        }

        if (!room || !playerId) return fail("join a room first");
        const isHost = room.game.hostId === playerId;

        switch (msg.type) {
          case "start":
          case "playAgain":
            if (!isHost) return fail("only the host can start the game");
            room.start();
            return;
          case "pick":
            await room.pick(playerId, msg.tileId);
            return;
          case "draft":
            room.draft(playerId, msg.text);
            return;
          case "lock":
            await room.lock(playerId);
            return;
          case "advance":
            if (!isHost) return fail("only the host can skip ahead");
            room.advance();
            return;
          default:
            return fail("unknown message");
        }
      } catch (err) {
        if (err instanceof GameError || err instanceof BoardGenerationError) {
          return fail(err.message);
        }
        console.error("ws error", err);
        fail("something went wrong");
      }
    });

    socket.on("close", () => room?.leave(socket));
    socket.on("error", () => room?.leave(socket));
  });

  server.listen(PORT, () => {
    console.log(`krillion-jeopardy server listening on http://localhost:${PORT}`);
    console.log(`  ws://localhost:${PORT}/ws`);
  });
}

/**
 * The Catch: one prompt's answers, filtered and paged, mirroring krillion.io's
 * post-game browser (tier chips, search box, 100 at a time).
 */
/**
 * A QR of the join URL, for the shared screen to display.
 *
 * The origin comes from the screen's own `location.origin`, not from this
 * server's view of the request: in dev the Vite proxy rewrites Host to
 * localhost:8787, and a phone cannot reach that.
 *
 * But the screen is very often opened ON this machine, at localhost — which a
 * phone cannot reach either. So a loopback origin is rewritten to the LAN
 * address, keeping the port. Only a non-loopback origin is taken as given.
 *
 * The parameter is validated to a bare http(s) host[:port] and the path is
 * built here, so it cannot steer the QR at an arbitrary URL.
 */
async function serveJoinQr(res: ServerResponse, code: string, url: URL): Promise<void> {
  const raw = url.searchParams.get("origin") ?? "";
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(raw)) {
    return json(res, 400, { error: "bad origin" });
  }
  const origin = reachableOrigin(raw);

  const svg = await QRCode.toString(`${origin}/?code=${code}`, {
    type: "svg",
    margin: 2,
    // Dark modules on light, which is the way round the QR spec assumes. An
    // inverted code suits the dark screen better but not every scanner reads
    // one, and this exists to be scanned by whatever phone someone brought.
    // Palette ink rather than pure black/white, so it still sits in the design.
    color: { dark: "#04161e", light: "#edf4f7" },
  });

  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": Buffer.byteLength(svg),
    // The code is fixed for the room's life, but a room is short-lived.
    "cache-control": "public, max-age=60",
  });
  res.end(svg);
}

async function serveCatch(
  res: ServerResponse,
  room: Room,
  promptId: string,
  url: URL,
  catalogue: Catalogue,
): Promise<void> {
  if (room.game.phase !== "finished") {
    return json(res, 403, { error: "answers open once the game is over" });
  }
  // Only prompts this room actually played — not the other 834.
  if (!room.game.played.some((p) => p.promptId === promptId)) {
    return json(res, 404, { error: "that prompt was not played in this room" });
  }

  let loaded;
  try {
    loaded = await catalogue.prompt(promptId);
  } catch {
    return json(res, 404, { error: "no such prompt" });
  }

  const tier = url.searchParams.get("tier") as Tier | null;
  const q = (url.searchParams.get("q") ?? "").trim();
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("limit") ?? PAGE_SIZE) || PAGE_SIZE),
  );

  // Rarest first: the one-in-a-krillion answers are what people open this to
  // read, and a list running to thousands would otherwise bury them behind the
  // obvious ones. Copied before sorting — `loaded.answers` is the catalogue's
  // cached array, shared with the matcher.
  let rows = [...loaded.answers].sort(
    (a, b) => b.score - a.score || a.answer.localeCompare(b.answer),
  );
  if (tier) rows = rows.filter((a) => a.tier === tier);
  if (q) {
    const needle = normalize(q);
    if (needle) rows = rows.filter((a) => a.key.includes(needle));
  }

  const page = rows.slice(offset, offset + limit).map((a) => ({
    answer: a.answer, score: a.score, tier: a.tier,
  }));

  json(res, 200, {
    promptId,
    promptText: loaded.meta.text,
    total: loaded.meta.answerCount,
    tierCounts: loaded.meta.tierCounts,
    matched: rows.length,
    offset,
    limit,
    answers: page,
  });
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
