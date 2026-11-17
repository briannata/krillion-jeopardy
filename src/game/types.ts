/**
 * The wire contract: everything the server sends to a client, and everything a
 * client may send back.
 *
 * The hard rule running through this file: **nothing here ever carries a prompt's
 * answer list.** A client learns a score for text it submitted, and after the game
 * it may page through answers via the archive endpoint. It never receives the list
 * itself during play.
 *
 * A second, easier-to-break rule: during `answering`, a player's own draft is
 * private. `PublicSubmission` deliberately has no text field — only whether that
 * player has locked in. The text appears in `RevealEntry`, which is only built once
 * the round is over.
 */

import type { Tier } from "../../scripts/krillion.ts";
import type { Theme } from "../../scripts/apply-labels.ts";

export type Phase = "lobby" | "picking" | "answering" | "revealing" | "finished";

/** points x 10 = metres, per the dive metaphor. */
export const METRES_PER_POINT = 10;

export interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  isHost: boolean;
}

export interface TileView {
  id: string;
  /** Column index, 0-based. */
  column: number;
  /** Set only once the tile has been played — the board shows blanks. */
  playedBy?: string;
  played: boolean;
}

export interface ColumnView {
  theme: Theme;
  /** Display name for the theme, e.g. "Food & Drink". */
  label: string;
  tileIds: string[];
}

/** What everyone knows about a player's submission while the timer runs. */
export interface PublicSubmission {
  playerId: string;
  locked: boolean;
  /** True once any non-empty text has been entered, to drive "typing…" dots. */
  started: boolean;
}

/** One player's result, only ever sent during `revealing` or later. */
export interface RevealEntry {
  playerId: string;
  /** Exactly what the player typed. */
  text: string;
  /** The stored answer it resolved to, absent when nothing matched. */
  matchedAnswer?: string;
  tier?: Tier;
  points: number;
}

/** Reveals go out one tier at a time, lowest first. */
export interface RevealBatch {
  /** Absent for the "nothing matched" batch that opens the reveal. */
  tier?: Tier;
  points: number;
  entries: RevealEntry[];
}

export interface RoundView {
  number: number;
  tileId: string;
  promptText: string;
  theme: Theme;
  /** Epoch ms; absent outside `answering`. */
  deadline?: number;
  submissions: PublicSubmission[];
  /** Batches revealed SO FAR. Grows as the reveal advances. */
  revealed: RevealBatch[];
  /** Total batches in this round's reveal, so a client can show progress. */
  revealTotal: number;
}

/** The per-socket private slice: what only you can see. */
export interface SelfView {
  playerId: string;
  /** Your current draft during `answering`. */
  draft: string;
  locked: boolean;
}

export interface GameView {
  code: string;
  phase: Phase;
  players: PlayerView[];
  columns: ColumnView[];
  tiles: TileView[];
  pickerId: string | null;
  round: RoundView | null;
  roundNumber: number;
  totalRounds: number;
  /** Populated once `finished`: the prompts played, for The Catch. */
  catch?: CatchEntry[];
  you: SelfView | null;
}

/** One played prompt, for the post-game archive browser. */
export interface CatchEntry {
  promptId: string;
  promptText: string;
  theme: Theme;
  answerCount: number;
  tierCounts: Partial<Record<Tier, number>>;
  /** What the room actually said, so players can find themselves. */
  roomAnswers: RevealEntry[];
}

// --- client -> server -------------------------------------------------------

export type ClientMessage =
  | { type: "join"; code: string; name: string; token?: string }
  | { type: "start" }
  | { type: "pick"; tileId: string }
  /** Draft update. Not scored, not shown to anyone else. */
  | { type: "draft"; text: string }
  | { type: "lock" }
  /** Host may push the reveal along rather than waiting on the timer. */
  | { type: "advance" }
  | { type: "playAgain" };

// --- server -> client -------------------------------------------------------

export type ServerMessage =
  | { type: "joined"; playerId: string; token: string }
  | { type: "state"; state: GameView }
  | { type: "error"; message: string };

/** Human-readable column headings. */
export const THEME_LABELS: Record<Theme, string> = {
  animals: "Animals",
  arts: "Arts & Design",
  "body-health": "Body & Health",
  brands: "Brands",
  everyday: "Everyday Life",
  "food-drink": "Food & Drink",
  gaming: "Games",
  geography: "Geography",
  "history-belief": "History & Belief",
  music: "Music",
  people: "Famous People",
  "science-space": "Science & Space",
  screen: "Film & TV",
  sports: "Sport",
  tech: "Tech",
  "words-books": "Words & Books",
};
