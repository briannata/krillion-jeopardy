/**
 * Plays whole games through the engine against the real catalogue.
 *
 * The engine takes `now` and `rng` as arguments, so a 20-round game runs in
 * milliseconds with no sockets and no waiting on timers.
 *
 * Usage: npm run test:engine
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Game, TOTAL_TILES, type ScoredSubmission } from "../src/game/engine.ts";
import { BoardGenerationError, generateBoard, seededRng } from "../src/game/board.ts";
import { TIER_POINTS, type Tier } from "./krillion.ts";
import type { CataloguePrompt } from "./apply-labels.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok && detail !== undefined) console.log(`         ${JSON.stringify(detail)}`);
}

const TIERS = Object.keys(TIER_POINTS) as Tier[];

/** Stand-in for the matcher: deterministic pseudo-scores. */
function fakeResults(game: Game, rng: () => number): ScoredSubmission[] {
  return game.pendingSubmissions().map(({ playerId, text }) => {
    if (!text.trim()) return { playerId, text, points: 0 };
    const roll = rng();
    if (roll < 0.15) return { playerId, text, points: 0 };
    const tier = TIERS[Math.floor(rng() * TIERS.length)]!;
    return { playerId, text, matchedAnswer: text, tier, points: TIER_POINTS[tier] };
  });
}

async function main() {
  const catalogue = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../data/catalogue.json"), "utf8"),
  ) as CataloguePrompt[];

  // --- A. board generation -------------------------------------------------
  console.log("A. board generation");
  {
    const rng = seededRng(42);
    const board = generateBoard(catalogue, new Set(), rng);
    check("5 columns", board.columns.length === 5, board.columns.length);
    check("20 tiles", board.tiles.length === TOTAL_TILES, board.tiles.length);
    check("themes are distinct", new Set(board.columns.map((c) => c.theme)).size === 5);
    check("prompts are distinct", new Set(board.tiles.map((t) => t.promptId)).size === TOTAL_TILES);
    check("only good prompts", board.tiles.every((t) =>
      catalogue.find((c) => c.id === t.promptId)?.quality === "good"));
    check("tile themes match their column", board.tiles.every((t) =>
      board.columns[t.column]!.theme === t.theme));
  }

  // --- B. a room never repeats a prompt ------------------------------------
  console.log("\nB. repeated boards in one room");
  {
    const rng = seededRng(7);
    const used = new Set<string>();
    let boards = 0;
    let ranOut: string | null = null;
    try {
      for (let i = 0; i < 200; i++) {
        const b = generateBoard(catalogue, used, rng);
        for (const t of b.tiles) {
          if (used.has(t.promptId)) throw new Error(`repeat: ${t.promptId}`);
          used.add(t.promptId);
        }
        boards++;
      }
    } catch (err) {
      if (err instanceof BoardGenerationError) ranOut = err.message;
      else throw err;
    }
    console.log(`  ${boards} boards before the pool ran dry`);
    check("at least 20 boards per room", boards >= 20, boards);
    check("no prompt repeated across boards", used.size === boards * TOTAL_TILES);
    check("running out is a clean error", ranOut !== null);
  }

  // --- C. thin themes are not exhausted early ------------------------------
  console.log("\nC. thin-theme weighting");
  {
    // `people` has 6 good prompts: one column. Uniform theme choice would pick it
    // ~31% of the time and wedge a room early. Weighting should keep it rare.
    const counts = new Map<string, number>();
    const rng = seededRng(99);
    for (let i = 0; i < 400; i++) {
      for (const c of generateBoard(catalogue, new Set(), rng).columns) {
        counts.set(c.theme, (counts.get(c.theme) ?? 0) + 1);
      }
    }
    const people = counts.get("people") ?? 0;
    const geography = counts.get("geography") ?? 0;
    console.log(`  over 400 boards: geography ${geography}x, people ${people}x`);
    check("deep themes appear far more than thin ones", geography > people * 5, { geography, people });
    check("thin themes still appear sometimes", people > 0, people);
  }

  // --- D. a full 20-round game ---------------------------------------------
  console.log("\nD. full game");
  {
    const rng = seededRng(2024);
    const game = new Game("TEST", catalogue, rng);
    let now = 1_000_000;

    for (const [i, name] of ["Ada", "Bo", "Cy", "Di"].entries()) {
      game.addPlayer(`p${i}`, name, now + i);
    }
    check("host is the first joiner", game.hostId === "p0", game.hostId);

    game.start(now);
    check("phase is picking", game.phase === "picking");
    check("opening pick belongs to the host", game.pickerId === "p0", game.pickerId);

    const pickerHistory: string[] = [];
    for (let round = 0; round < TOTAL_TILES; round++) {
      const view = game.view("p0");
      const open = view.tiles.filter((t) => !t.played);
      check(`round ${round + 1}: tiles remaining`, open.length === TOTAL_TILES - round);

      const picker = game.pickerId!;
      pickerHistory.push(picker);

      // Someone who is not the picker tries to pick.
      const intruder = ["p0", "p1", "p2", "p3"].find((p) => p !== picker)!;
      let rejected = false;
      try { game.pick(intruder, open[0]!.id, now); } catch { rejected = true; }
      check(`round ${round + 1}: non-picker rejected`, rejected);

      game.pick(picker, open[Math.floor(rng() * open.length)]!.id, now);
      if (round === 0) {
        // Answers must stay private while the timer runs.
        game.draft("p1", "a secret answer");
        const other = game.view("p2");
        const leaked = JSON.stringify(other.round?.submissions).includes("secret");
        check("drafts are not visible to other players", !leaked);
        check("you see your own draft", game.view("p1").you?.draft === "a secret answer");
        check("revealed is empty while answering", other.round?.revealed.length === 0);
      }

      for (const p of ["p0", "p1", "p2", "p3"]) {
        if (rng() < 0.9) game.draft(p, `answer-${round}-${p}`);
      }
      now += 5_000;
      game.lock("p0", now);
      now += 1_000;

      const before = game.view("p0").players.reduce((s, p) => s + p.score, 0);
      const results = fakeResults(game, rng);
      game.scoreRound(results);
      check(`round ${round + 1}: revealing`, game.phase === "revealing");

      const expected = results.reduce((s, r) => s + r.points, 0);
      const after = game.view("p0").players.reduce((s, p) => s + p.score, 0);
      check(`round ${round + 1}: scores add up`, after - before === expected, { before, after, expected });

      // Reveal is batched by tier, so it never costs more steps than there are tiers.
      const total = game.round!.batches.length;
      check(`round ${round + 1}: batches <= tiers+1`, total <= TIERS.length + 1, total);
      let steps = 0;
      while (game.advanceReveal()) steps++;
      check(`round ${round + 1}: reveal completes`, game.revealComplete);
      check(`round ${round + 1}: steps match batches`, steps === Math.max(0, total - 1), { steps, total });

      // Batches go surface -> deep.
      const points = game.round!.batches.map((b) => b.points);
      check(`round ${round + 1}: batches ascend`, points.every((p, i) => i === 0 || p >= points[i - 1]!), points);

      game.endRound();
    }

    check("game finished", game.phase === "finished", game.phase);
    check("all 20 tiles played", game.view("p0").tiles.every((t) => t.played));
    check("20 prompts recorded for The Catch", game.view("p0").catch?.length === TOTAL_TILES);
    check("picker changed hands", new Set(pickerHistory).size > 1, [...new Set(pickerHistory)]);

    const scores = game.view("p0").players;
    check("scoreboard is sorted", scores.every((p, i) => i === 0 || p.score <= scores[i - 1]!.score));
    console.log(`  final: ${scores.map((p) => `${p.name} ${p.score} (${p.score * 10}m)`).join(" · ")}`);

    // A second game in the same room must not reuse prompts.
    const firstGame = new Set(game.view("p0").catch!.map((c) => c.promptId));
    game.start(now);
    const secondGame = game.view("p0").tiles.map((t, i) => game.board!.tiles[i]!.promptId);
    check("second game reuses no prompt", secondGame.every((id) => !firstGame.has(id)));
    check("scores reset", game.view("p0").players.every((p) => p.score === 0));
  }

  // --- E. reconnection -----------------------------------------------------
  console.log("\nE. reconnection");
  {
    const game = new Game("RJN", catalogue, seededRng(5));
    game.addPlayer("a", "Ada", 1);
    game.addPlayer("b", "Bo", 2);
    game.start(10);
    game.pick("a", game.view("a").tiles[0]!.id, 10);
    game.scoreRound([
      { playerId: "a", text: "x", tier: "rare", points: 60, matchedAnswer: "X" },
      { playerId: "b", text: "y", points: 0 },
    ]);
    while (game.advanceReveal()) { /* drain */ }
    game.endRound();

    const scoreBefore = game.view("a").players.find((p) => p.id === "a")!.score;
    game.setConnected("a", false);
    game.addPlayer("a", "Ada", 99); // rejoin
    const scoreAfter = game.view("a").players.find((p) => p.id === "a")!.score;
    check("score survives a reconnect", scoreBefore === scoreAfter, { scoreBefore, scoreAfter });
    check("player is connected again", game.view("a").players.find((p) => p.id === "a")!.connected);
    check("host did not change", game.hostId === "a", game.hostId);
  }

  console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
