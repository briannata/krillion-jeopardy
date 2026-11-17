/**
 * Board generation: 5 themed columns of 4 prompts.
 *
 * Two things this has to get right.
 *
 * 1. **No repeats within a room.** A room remembers every prompt it has played, so
 *    a second game never replays one. With 751 good prompts that is ~37 boards.
 *
 * 2. **Theme depth.** `people` has only 6 good prompts — one column — while
 *    `geography` has 118. Picking themes uniformly would make a room run out of
 *    `people` prompts after one game and then fail to build a board at all. Themes
 *    are therefore weighted by how many UNUSED good prompts they still have, and a
 *    theme that can no longer fill a column is skipped entirely. That is the fix for
 *    the thin-theme problem, and it needs no change to the labels.
 */

import type { CataloguePrompt, Theme } from "../../scripts/apply-labels.ts";

export const BOARD_COLUMNS = 5;
export const TILES_PER_COLUMN = 4;
export const TOTAL_TILES = BOARD_COLUMNS * TILES_PER_COLUMN;

export interface BoardTile {
  id: string;
  column: number;
  promptId: string;
  promptText: string;
  theme: Theme;
}

export interface Board {
  columns: { theme: Theme; tileIds: string[] }[];
  tiles: BoardTile[];
}

export type Rng = () => number;

function pick<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Draw `n` distinct items, weighted by `weight`. */
function weightedSample<T>(items: T[], n: number, weight: (t: T) => number, rng: Rng): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, t) => s + weight(t), 0);
    if (total <= 0) break;
    let roll = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= weight(pool[i]!);
      if (roll <= 0) { idx = i; break; }
    }
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export class BoardGenerationError extends Error {}

/**
 * @param catalogue  every prompt
 * @param used       prompt ids this room has already played
 */
export function generateBoard(
  catalogue: CataloguePrompt[],
  used: ReadonlySet<string>,
  rng: Rng = Math.random,
): Board {
  const available = catalogue.filter((p) => p.quality === "good" && !used.has(p.id));

  const byTheme = new Map<Theme, CataloguePrompt[]>();
  for (const p of available) {
    const bucket = byTheme.get(p.theme);
    if (bucket) bucket.push(p);
    else byTheme.set(p.theme, [p]);
  }

  // Only themes that can still fill a whole column are eligible.
  const eligible = [...byTheme.entries()].filter(([, ps]) => ps.length >= TILES_PER_COLUMN);
  if (eligible.length < BOARD_COLUMNS) {
    throw new BoardGenerationError(
      `only ${eligible.length} themes can still fill a column of ${TILES_PER_COLUMN}; ` +
        `this room has played ${used.size} prompts. Start a fresh room.`,
    );
  }

  // Weight by remaining depth so deep themes come up more often and thin ones are
  // spent sparingly, rather than being exhausted by an unlucky early draw.
  const chosen = weightedSample(eligible, BOARD_COLUMNS, ([, ps]) => ps.length, rng);

  const tiles: BoardTile[] = [];
  const columns = chosen.map(([theme, prompts], column) => {
    const picked = shuffle(prompts, rng).slice(0, TILES_PER_COLUMN);
    const tileIds = picked.map((p, row) => {
      const id = `t${column}-${row}`;
      tiles.push({ id, column, promptId: p.id, promptText: p.text, theme });
      return id;
    });
    return { theme, tileIds };
  });

  return { columns, tiles };
}

/** Deterministic RNG, so tests and replays are reproducible. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { pick };
