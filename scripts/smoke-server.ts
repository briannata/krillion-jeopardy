/**
 * End-to-end smoke test against a running server: real HTTP, real WebSockets, real
 * matcher, real answer data.
 *
 * The engine tests already play full games; this one exists to check the things
 * only the wire can be wrong about — room codes, broadcast, reconnection by token,
 * and above all that **no answer list ever crosses the socket**.
 *
 * Usage: npm start   (in another shell)
 *        npm run smoke
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import type { ClientMessage, GameView, ServerMessage } from "../src/game/types.ts";
import type { PromptFile } from "./build-dataset.ts";

/**
 * The TEST may read the answer data off disk to choose a valid answer — it runs on
 * the server machine. The CLIENTS still learn nothing; that is the whole point of
 * the leakage checks below.
 */
async function promptIdFromText(text: string): Promise<string | null> {
  const catalogue = JSON.parse(await readFile(
    resolve(import.meta.dirname, "../data/catalogue.json"), "utf8",
  )) as { id: string; text: string }[];
  return catalogue.find((p) => p.text === text)?.id ?? null;
}

async function pickKnownAnswer(promptId: string, tier: string) {
  const file = JSON.parse(await readFile(
    resolve(import.meta.dirname, `../data/prompts/${promptId}.json`), "utf8",
  )) as PromptFile;
  return file.answers.find((a) => a.tier === tier) ?? file.answers[0]!;
}

const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const WS = BASE.replace(/^http/, "ws") + "/ws";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok && detail !== undefined) console.log(`         ${JSON.stringify(detail).slice(0, 300)}`);
}

/** A test client that records everything the server sends it. */
class Client {
  readonly frames: string[] = [];
  state: GameView | null = null;
  playerId = "";
  token = "";
  private socket!: WebSocket;

  static async connect(name: string, code: string, token?: string): Promise<Client> {
    const c = new Client();
    c.socket = new WebSocket(WS);
    await new Promise<void>((ok, bad) => {
      c.socket.once("open", () => ok());
      c.socket.once("error", bad);
    });
    c.socket.on("message", (raw) => {
      const text = String(raw);
      c.frames.push(text);
      const msg = JSON.parse(text) as ServerMessage;
      if (msg.type === "state") c.state = msg.state;
      if (msg.type === "joined") { c.playerId = msg.playerId; c.token = msg.token; }
      if (msg.type === "error") console.log(`         [${name}] server error: ${msg.message}`);
    });
    c.send({ type: "join", code, name, ...(token ? { token } : {}) });
    await c.until(() => !!c.playerId && !!c.state, "join");
    return c;
  }

  send(msg: ClientMessage): void { this.socket.send(JSON.stringify(msg)); }
  close(): void { this.socket.close(); }

  async until(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

async function main() {
  console.log(`smoke test against ${BASE}`);

  const health = await fetch(`${BASE}/health`).then((r) => r.json()) as { ok: boolean };
  check("server is healthy", health.ok === true);

  const created = await fetch(`${BASE}/api/rooms`, { method: "POST" })
    .then((r) => r.json()) as { code: string };
  const code = created.code;
  check("room code is 4 letters", /^[A-Z]{4}$/.test(code), code);
  check("code avoids lookalike letters", !/[IO01]/.test(code), code);

  console.log(`\nroom ${code}`);
  const ada = await Client.connect("Ada", code);
  const bo = await Client.connect("Bo", code);
  await ada.until(() => (ada.state?.players.length ?? 0) === 2, "both players visible");
  check("both players in the lobby", ada.state!.players.length === 2);
  check("Ada is host", ada.state!.players.find((p) => p.id === ada.playerId)?.isHost === true);
  check("Bo is not host", bo.state!.players.find((p) => p.id === bo.playerId)?.isHost === false);

  // Non-host cannot start.
  bo.send({ type: "start" });
  await new Promise((r) => setTimeout(r, 200));
  check("non-host cannot start", ada.state!.phase === "lobby", ada.state!.phase);

  ada.send({ type: "start" });
  await ada.until(() => ada.state?.phase === "picking", "picking");
  check("board has 5 columns", ada.state!.columns.length === 5);
  check("board has 20 tiles", ada.state!.tiles.length === 20);
  check("columns are labelled", ada.state!.columns.every((c) => !!c.label));
  check("no prompt text on the board", !JSON.stringify(ada.state!.columns).includes("Name a"));
  console.log(`  themes: ${ada.state!.columns.map((c) => c.label).join(", ")}`);

  // Wrong player picks.
  bo.send({ type: "pick", tileId: ada.state!.tiles[0]!.id });
  await new Promise((r) => setTimeout(r, 200));
  check("non-picker cannot pick", ada.state!.phase === "picking", ada.state!.phase);

  ada.send({ type: "pick", tileId: ada.state!.tiles[0]!.id });
  await ada.until(() => ada.state?.phase === "answering", "answering");
  const prompt = ada.state!.round!.promptText;
  console.log(`  prompt: "${prompt}"`);
  check("prompt arrives with a deadline", typeof ada.state!.round!.deadline === "number");

  // Drafts must stay private.
  ada.send({ type: "draft", text: "zzz-ada-secret-zzz" });
  await new Promise((r) => setTimeout(r, 300));
  check("own draft comes back to you", ada.state!.you?.draft === "zzz-ada-secret-zzz");
  check("draft never reaches the other player",
    !bo.frames.some((f) => f.includes("zzz-ada-secret-zzz")));
  check("other player sees only a 'started' flag",
    bo.state!.round!.submissions.some((s) => s.playerId === ada.playerId && s.started));

  // Bo answers correctly, using a real Plankton answer for THIS prompt.
  // The prompt id is resolved from its TEXT against the local catalogue — the server
  // deliberately does not expose the live prompt id, since that alone would let a
  // player look the answers up on the archive site mid-round.
  const promptId = await promptIdFromText(prompt);
  check("prompt text resolves to a catalogue prompt", !!promptId, prompt);
  const known = await pickKnownAnswer(promptId!, "plankton");
  console.log(`  Bo answers "${known.answer}" (stored ${known.tier}, ${known.score}pts)`);
  bo.send({ type: "draft", text: known.answer });
  await new Promise((r) => setTimeout(r, 150));

  // Ada is still holding gibberish. Locking it must be REFUSED: an answer that
  // matches nothing is worth zero, and she should find that out now, while she
  // can still think again, rather than at the reveal.
  const beforeLock = ada.frames.length;
  ada.send({ type: "lock" });
  await new Promise((r) => setTimeout(r, 250));
  check("unmatched answer is refused at lock",
    ada.frames.slice(beforeLock).some((f) => f.includes("on the list")));
  check("a refused lock leaves the player unlocked", !ada.state!.you?.locked);
  check("the refusal goes only to that player",
    !bo.frames.some((f) => f.includes("on the list")));

  // She tries again with Bo's answer. Duplicates are allowed and score
  // independently — picking the same obvious word does not split the points.
  ada.send({ type: "draft", text: known.answer });
  await new Promise((r) => setTimeout(r, 150));
  ada.send({ type: "lock" });
  bo.send({ type: "lock" });
  await new Promise((r) => setTimeout(r, 250));
  check("a matching answer locks", !!ada.state!.you?.locked);

  await ada.until(() => ada.state?.phase === "revealing", "revealing");
  check("locking shortens the round", true);
  await ada.until(
    () => (ada.state?.round?.revealed.length ?? 0) >= (ada.state?.round?.revealTotal ?? 1),
    "reveal to finish",
  );

  const revealed = ada.state!.round!.revealed;
  console.log(`  revealed in ${revealed.length} tier batch(es): ` +
    revealed.map((b) => `${b.tier ?? "miss"}=${b.points}`).join(", "));
  check("reveal is batched by tier, not by player", revealed.length <= 7, revealed.length);
  check("both answers appear in the reveal",
    revealed.flatMap((b) => b.entries).length === 2);

  const boEntry = revealed.flatMap((b) => b.entries).find((e) => e.playerId === bo.playerId)!;
  const adaEntry = revealed.flatMap((b) => b.entries).find((e) => e.playerId === ada.playerId)!;
  check("real answer scored its stored tier", boEntry.points === known.score,
    { got: boEntry.points, want: known.score, tier: boEntry.tier });
  check("matched answer is echoed back", boEntry.matchedAnswer === known.answer,
    { got: boEntry.matchedAnswer, want: known.answer });
  check("duplicate answers score independently",
    adaEntry.points === known.score && boEntry.points === known.score,
    { ada: adaEntry.points, bo: boEntry.points, want: known.score });
  check("miss batch comes before the scoring batch",
    revealed[0]!.points <= revealed[revealed.length - 1]!.points);

  await ada.until(() => ada.state?.phase === "picking", "next round");
  const scores = ada.state!.players.map((p) => `${p.name} ${p.score}`);
  console.log(`  scores: ${scores.join(" · ")}`);
  check("scoring player is ahead",
    ada.state!.players.find((p) => p.id === bo.playerId)!.score === known.score);

  // Both gave the same answer, so both are on the same score. The picker is the
  // round's top scorer, chosen at RANDOM among ties — so the test can only
  // assert that it is one of the leaders, never which one.
  const top = Math.max(...ada.state!.players.map((p) => p.score));
  const leaders = ada.state!.players.filter((p) => p.score === top).map((p) => p.id);
  check("next picker is a round winner", leaders.includes(ada.state!.pickerId!),
    { picker: ada.state!.pickerId, leaders, top });

  // --- the thing that matters most ----------------------------------------
  console.log("\nanswer leakage");
  const allFrames = [...ada.frames, ...bo.frames].join("\n");
  check("no 'answers' array in any frame", !allFrames.includes('"answers"'));
  check("no 'key' field (normalized answer) in any frame", !allFrames.includes('"key"'));
  const biggest = Math.max(...[...ada.frames, ...bo.frames].map((f) => f.length));
  check("no frame is answer-list sized", biggest < 200_000, biggest);
  console.log(`  largest frame: ${(biggest / 1024).toFixed(1)}KB`);

  // --- The Catch is gated --------------------------------------------------
  console.log("\nThe Catch endpoint");
  const playedId = ada.state!.catch?.[0]?.promptId;
  const probe = await fetch(`${BASE}/api/rooms/${code}/catch/d87-p1`);
  check("refuses before the game is over", probe.status === 403, probe.status);
  const body = await probe.json() as { error?: string };
  check("says why", typeof body.error === "string", body);
  check("no catch data in state mid-game", playedId === undefined);

  const noRoom = await fetch(`${BASE}/api/rooms/ZZZZ`);
  check("unknown room is a 404", noRoom.status === 404, noRoom.status);

  // --- reconnection --------------------------------------------------------
  console.log("\nreconnection");
  const scoreBefore = ada.state!.players.find((p) => p.id === bo.playerId)!.score;
  bo.close();
  await new Promise((r) => setTimeout(r, 300));
  const boAgain = await Client.connect("Bo", code, bo.token);
  check("same player id after reconnect", boAgain.playerId === bo.playerId);
  const scoreAfter = boAgain.state!.players.find((p) => p.id === bo.playerId)!.score;
  check("score survived", scoreBefore === scoreAfter, { scoreBefore, scoreAfter });
  check("player count unchanged", boAgain.state!.players.length === 2, boAgain.state!.players.length);

  ada.close();
  boAgain.close();

  console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
