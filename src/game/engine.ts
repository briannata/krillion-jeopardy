/**
 * The game state machine. Pure: no sockets, no timers, no file IO.
 *
 * Time enters only as an explicit `now` argument and randomness only as an injected
 * `rng`, so a whole 20-round game can be played out in a test in milliseconds, and
 * a bug is reproducible from a seed.
 *
 * The runtime (src/server/room.ts) owns the clock and the sockets, loads the answer
 * data, and calls `scoreRound` with match results it got from the matcher. The
 * engine never sees an answer list.
 *
 * Phases: lobby -> picking -> answering -> revealing -> (picking | finished)
 */

import {
  BOARD_COLUMNS, TILES_PER_COLUMN, TOTAL_TILES,
  generateBoard, type Board, type BoardTile, type Rng,
} from "./board.ts";
import {
  THEME_LABELS, type CatchEntry, type GameView, type Phase, type PublicSubmission,
  type RevealBatch, type RevealEntry, type RoundView, type SelfView, type TileView,
} from "./types.ts";
import { TIER_ORDER, type Tier } from "../../scripts/krillion.ts";
import type { CataloguePrompt } from "../../scripts/apply-labels.ts";

export const ANSWER_MS = 30_000;
/** Once everyone has locked, give stragglers a beat rather than cutting instantly. */
export const ALL_LOCKED_GRACE_MS = 1_500;

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  /** Join order decides the host and the opening picker. */
  joinedAt: number;
}

export interface Submission {
  text: string;
  locked: boolean;
  /** Epoch ms of the lock — the tie-break for who picks next. */
  lockedAt?: number;
}

/** What the runtime hands back after matching a round's submissions. */
export interface ScoredSubmission {
  playerId: string;
  text: string;
  matchedAnswer?: string;
  tier?: Tier;
  points: number;
}

export interface Round {
  number: number;
  tile: BoardTile;
  deadline: number;
  submissions: Map<string, Submission>;
  batches: RevealBatch[];
  /** How many batches have been shown. */
  revealIndex: number;
}

export interface PlayedPrompt {
  promptId: string;
  promptText: string;
  theme: BoardTile["theme"];
  results: RevealEntry[];
}

export class GameError extends Error {}

export class Game {
  phase: Phase = "lobby";
  readonly players = new Map<string, Player>();
  board: Board | null = null;
  pickerId: string | null = null;
  round: Round | null = null;
  roundNumber = 0;
  /** Prompt ids this room has played, across games. */
  readonly usedPromptIds = new Set<string>();
  readonly played: PlayedPrompt[] = [];
  private playedTiles = new Set<string>();
  private tilePlayedBy = new Map<string, string>();

  constructor(
    readonly code: string,
    private readonly catalogue: CataloguePrompt[],
    private readonly rng: Rng = Math.random,
  ) {}

  // --- lobby ---------------------------------------------------------------

  /** Idempotent by player id, so a reconnect keeps the player's score. */
  addPlayer(id: string, name: string, now: number): Player {
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      return existing;
    }
    const clean = name.trim().slice(0, 24) || "Player";
    const player: Player = { id, name: clean, connected: true, score: 0, joinedAt: now };
    this.players.set(id, player);
    return player;
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  /** First to join, among those still connected; falls back to first overall. */
  get hostId(): string | null {
    const byJoin = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    return (byJoin.find((p) => p.connected) ?? byJoin[0])?.id ?? null;
  }

  start(now: number): void {
    if (this.phase !== "lobby" && this.phase !== "finished") {
      throw new GameError("game already started");
    }
    if (this.players.size === 0) throw new GameError("nobody has joined");

    this.board = generateBoard(this.catalogue, this.usedPromptIds, this.rng);
    for (const t of this.board.tiles) this.usedPromptIds.add(t.promptId);

    this.playedTiles = new Set();
    this.tilePlayedBy = new Map();
    this.played.length = 0;
    this.roundNumber = 0;
    this.round = null;
    for (const p of this.players.values()) p.score = 0;

    // Opening pick goes to the host; after that it is the previous round's winner.
    this.pickerId = this.hostId;
    this.phase = "picking";
    void now;
  }

  // --- picking -------------------------------------------------------------

  pick(playerId: string, tileId: string, now: number): BoardTile {
    if (this.phase !== "picking") throw new GameError("not picking right now");
    if (playerId !== this.pickerId) throw new GameError("it is not your pick");
    if (this.playedTiles.has(tileId)) throw new GameError("that tile is already played");

    const tile = this.board?.tiles.find((t) => t.id === tileId);
    if (!tile) throw new GameError("no such tile");

    this.roundNumber++;
    this.round = {
      number: this.roundNumber,
      tile,
      deadline: now + ANSWER_MS,
      submissions: new Map(),
      batches: [],
      revealIndex: 0,
    };
    this.phase = "answering";
    return tile;
  }

  // --- answering -----------------------------------------------------------

  draft(playerId: string, text: string): void {
    if (this.phase !== "answering") return;
    const round = this.round!;
    const existing = round.submissions.get(playerId);
    if (existing?.locked) return; // locked is final
    round.submissions.set(playerId, { text: text.slice(0, 120), locked: false });
  }

  /** The text this player would be scored on right now. */
  draftOf(playerId: string): string {
    return this.round?.submissions.get(playerId)?.text ?? "";
  }

  lock(playerId: string, now: number): void {
    if (this.phase !== "answering") throw new GameError("not answering right now");
    const round = this.round!;
    const existing = round.submissions.get(playerId);
    if (existing?.locked) return;
    round.submissions.set(playerId, {
      text: existing?.text ?? "",
      locked: true,
      lockedAt: now,
    });
    // Everyone in: shorten the clock rather than ending dead on the spot.
    if (this.allLocked()) {
      round.deadline = Math.min(round.deadline, now + ALL_LOCKED_GRACE_MS);
    }
  }

  allLocked(): boolean {
    const active = [...this.players.values()].filter((p) => p.connected);
    if (!active.length) return false;
    const subs = this.round?.submissions;
    return active.every((p) => subs?.get(p.id)?.locked);
  }

  /** Everyone who should be scored this round, locked or not. */
  pendingSubmissions(): { playerId: string; text: string }[] {
    const round = this.round;
    if (!round) return [];
    return [...this.players.values()]
      .filter((p) => p.connected)
      .map((p) => ({ playerId: p.id, text: round.submissions.get(p.id)?.text ?? "" }));
  }

  // --- revealing -----------------------------------------------------------

  /**
   * Applies match results, builds the reveal batches, and moves to `revealing`.
   *
   * Batches are grouped BY TIER and ordered from the surface down, so a 20-player
   * room still reveals in at most 7 steps instead of 20. The misses go first: they
   * are the joke, not the climax.
   */
  scoreRound(results: ScoredSubmission[]): RevealBatch[] {
    if (this.phase !== "answering") throw new GameError("not answering right now");
    const round = this.round!;

    for (const r of results) {
      const player = this.players.get(r.playerId);
      if (player) player.score += r.points;
    }

    const entries = new Map<string, RevealEntry[]>();
    for (const r of results) {
      const key = r.tier ?? "__miss__";
      const entry: RevealEntry = {
        playerId: r.playerId,
        text: r.text,
        points: r.points,
        ...(r.matchedAnswer ? { matchedAnswer: r.matchedAnswer } : {}),
        ...(r.tier ? { tier: r.tier } : {}),
      };
      const bucket = entries.get(key);
      if (bucket) bucket.push(entry);
      else entries.set(key, [entry]);
    }

    const batches: RevealBatch[] = [];
    const misses = entries.get("__miss__");
    if (misses?.length) batches.push({ points: 0, entries: misses });
    for (const tier of TIER_ORDER) {
      const bucket = entries.get(tier);
      if (bucket?.length) batches.push({ tier, points: bucket[0]!.points, entries: bucket });
    }

    round.batches = batches;
    round.revealIndex = 0;
    this.phase = "revealing";

    this.playedTiles.add(round.tile.id);
    this.played.push({
      promptId: round.tile.promptId,
      promptText: round.tile.promptText,
      theme: round.tile.theme,
      results: batches.flatMap((b) => b.entries),
    });
    return batches;
  }

  /** Shows the next batch. Returns false when the reveal is finished. */
  advanceReveal(): boolean {
    if (this.phase !== "revealing") return false;
    const round = this.round!;
    if (round.revealIndex < round.batches.length) {
      round.revealIndex++;
      // Record who took the tile once the top batch is out.
      if (round.revealIndex === round.batches.length) {
        const top = round.batches[round.batches.length - 1]!;
        if (top.points > 0 && top.entries[0]) {
          this.tilePlayedBy.set(round.tile.id, top.entries[0].playerId);
        }
      }
    }
    return round.revealIndex < round.batches.length;
  }

  get revealComplete(): boolean {
    const round = this.round;
    return !!round && round.revealIndex >= round.batches.length;
  }

  /**
   * Ends the round: picks the next picker and either returns to the board or
   * finishes the game.
   *
   * Next picker is the round's highest scorer, **random among ties** — and ties are
   * the normal case here, not an edge case, because most answers land in the same
   * tier. If nobody scored, the pick simply stays put.
   */
  endRound(): void {
    if (this.phase !== "revealing") throw new GameError("not revealing right now");
    const round = this.round!;

    const scored = round.batches.flatMap((b) => b.entries).filter((e) => e.points > 0);
    if (scored.length) {
      const best = Math.max(...scored.map((e) => e.points));
      const winners = scored.filter((e) => e.points === best);
      this.pickerId = winners[Math.floor(this.rng() * winners.length)]!.playerId;
    }

    this.round = null;
    if (this.playedTiles.size >= TOTAL_TILES) {
      this.phase = "finished";
      this.pickerId = null;
    } else {
      // If the winner has since dropped, hand the pick to someone present.
      if (!this.players.get(this.pickerId ?? "")?.connected) this.pickerId = this.hostId;
      this.phase = "picking";
    }
  }

  // --- view ----------------------------------------------------------------

  view(forPlayerId: string | null): GameView {
    const round = this.round;
    const players = [...this.players.values()]
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id, name: p.name, connected: p.connected, score: p.score,
        isHost: p.id === this.hostId,
      }));

    const tiles: TileView[] = (this.board?.tiles ?? []).map((t) => {
      const played = this.playedTiles.has(t.id);
      return {
        id: t.id,
        column: t.column,
        played,
        // Only a played tile reveals its prompt.
        ...(played ? { promptText: t.promptText } : {}),
        ...(this.tilePlayedBy.has(t.id) ? { playedBy: this.tilePlayedBy.get(t.id)! } : {}),
      };
    });

    const columns = (this.board?.columns ?? []).map((c) => ({
      theme: c.theme, label: THEME_LABELS[c.theme], tileIds: c.tileIds,
    }));

    let roundView: RoundView | null = null;
    if (round) {
      const submissions: PublicSubmission[] = [...this.players.values()].map((p) => {
        const s = round.submissions.get(p.id);
        return { playerId: p.id, locked: !!s?.locked, started: !!s?.text };
      });
      roundView = {
        number: round.number,
        tileId: round.tile.id,
        promptText: round.tile.promptText,
        theme: round.tile.theme,
        ...(this.phase === "answering" ? { deadline: round.deadline } : {}),
        submissions,
        // Only batches already revealed are sent. This is the line that keeps the
        // reveal honest: an unrevealed batch is not in the payload at all.
        revealed: round.batches.slice(0, round.revealIndex),
        revealTotal: round.batches.length,
      };
    }

    const self = forPlayerId ? this.players.get(forPlayerId) : null;
    const you: SelfView | null = self
      ? {
          playerId: self.id,
          draft: round?.submissions.get(self.id)?.text ?? "",
          locked: !!round?.submissions.get(self.id)?.locked,
        }
      : null;

    return {
      code: this.code,
      phase: this.phase,
      players,
      columns,
      tiles,
      pickerId: this.pickerId,
      round: roundView,
      roundNumber: this.roundNumber,
      totalRounds: TOTAL_TILES,
      ...(this.phase === "finished" ? { catch: this.catchEntries() } : {}),
      you,
    };
  }

  /** The post-game prompt list. Answer lists are fetched separately, on demand. */
  private catchEntries(): CatchEntry[] {
    return this.played.map((p) => {
      const meta = this.catalogue.find((c) => c.id === p.promptId);
      return {
        promptId: p.promptId,
        promptText: p.promptText,
        theme: p.theme,
        answerCount: meta?.answerCount ?? 0,
        tierCounts: meta?.tierCounts ?? {},
        roomAnswers: p.results,
      };
    });
  }
}

export { BOARD_COLUMNS, TILES_PER_COLUMN, TOTAL_TILES };
