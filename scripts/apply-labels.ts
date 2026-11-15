/**
 * Joins hand-assigned theme labels onto the scraped index, validates coverage, and
 * writes the board-ready catalogue.
 *
 *   labels/themes.tsv   id -> theme                 (hand-assigned, committed)
 *   labels/quality.tsv  id -> exclude|weak + reason (hand-assigned, committed)
 *   data/index.json     scraped prompt metadata
 *     -> data/catalogue.json
 *
 * Quality combines the hand labels with two rules computed from the data, because
 * those are measurements rather than judgements:
 *   - a prompt with a huge answer list is too broad to feel like a category
 *   - a prompt that is nearly all one tier has no scoring gradient
 *
 * Usage: npm run apply:labels
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PromptMeta } from "./build-dataset.ts";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = resolve(ROOT, "data");

export const THEMES = [
  "animals", "arts", "body-health", "brands", "everyday", "food-drink",
  "gaming", "geography", "history-belief", "music", "people", "science-space",
  "screen", "sports", "tech", "words-books",
] as const;
export type Theme = (typeof THEMES)[number];
export type Quality = "good" | "weak" | "exclude";

export interface CataloguePrompt extends PromptMeta {
  theme: Theme;
  quality: Quality;
  /** Why it is not "good" — kept for review. */
  qualityReasons: string[];
  /** Share of this prompt's answers sitting in its single largest tier. */
  flatness: number;
}

/** More answers than this and it is a dictionary, not a category. */
const BROAD_ANSWER_COUNT = 20_000;
/** Almost every answer in one tier means no scoring gradient. */
const FLATNESS_LIMIT = 0.95;
/** Too few answers for a room of players to diverge. */
const THIN_ANSWER_COUNT = 12;

interface Row { value: string; note: string }

async function readTsv(path: string): Promise<Map<string, Row>> {
  const text = await readFile(resolve(ROOT, path), "utf8");
  const out = new Map<string, Row>();
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [id, value, ...rest] = trimmed.split("\t");
    if (!id || !value) throw new Error(`${path}:${i + 1} malformed: ${JSON.stringify(line)}`);
    if (out.has(id)) throw new Error(`${path}:${i + 1} duplicate id ${id}`);
    out.set(id, { value, note: rest.join(" ").trim() });
  });
  return out;
}

async function main() {
  const index = JSON.parse(await readFile(resolve(DATA, "index.json"), "utf8")) as PromptMeta[];
  const themes = await readTsv("labels/themes.tsv");
  const quality = await readTsv("labels/quality.tsv");

  // --- validate ------------------------------------------------------------
  const errors: string[] = [];
  const known = new Set(index.map((p) => p.id));

  for (const p of index) {
    if (!themes.has(p.id)) errors.push(`missing theme: ${p.id} - "${p.text.slice(0, 60)}"`);
  }
  for (const id of themes.keys()) if (!known.has(id)) errors.push(`theme for unknown prompt: ${id}`);
  for (const id of quality.keys()) if (!known.has(id)) errors.push(`quality for unknown prompt: ${id}`);
  for (const [id, row] of themes) {
    if (!(THEMES as readonly string[]).includes(row.value)) errors.push(`unknown theme "${row.value}" on ${id}`);
  }
  for (const [id, row] of quality) {
    if (row.value !== "weak" && row.value !== "exclude") errors.push(`unknown quality "${row.value}" on ${id}`);
  }
  if (errors.length) {
    for (const e of errors.slice(0, 25)) console.error("  " + e);
    if (errors.length > 25) console.error(`  ...and ${errors.length - 25} more`);
    throw new Error(`${errors.length} label problem(s)`);
  }

  // --- apply ---------------------------------------------------------------
  const catalogue: CataloguePrompt[] = index.map((p) => {
    const counts = Object.values(p.tierCounts) as number[];
    const flatness = p.answerCount ? Math.max(...counts, 0) / p.answerCount : 1;
    const reasons: string[] = [];

    const hand = quality.get(p.id);
    if (hand) reasons.push(hand.note || hand.value);
    if (p.answerCount > BROAD_ANSWER_COUNT) reasons.push(`too broad (${p.answerCount.toLocaleString()} answers)`);
    if (flatness > FLATNESS_LIMIT) reasons.push(`no gradient (${(flatness * 100).toFixed(0)}% one tier)`);
    if (p.answerCount < THIN_ANSWER_COUNT) reasons.push(`too thin (${p.answerCount} answers)`);
    if (p.duplicateOf) reasons.push(`repeats ${p.duplicateOf}`);

    const q: Quality = hand?.value === "exclude" ? "exclude" : reasons.length ? "weak" : "good";
    return { ...p, theme: themes.get(p.id)!.value as Theme, quality: q, qualityReasons: reasons, flatness };
  });

  await writeFile(resolve(DATA, "catalogue.json"), JSON.stringify(catalogue, null, 1), "utf8");

  // --- report --------------------------------------------------------------
  const BOARD_THEMES = 5;
  const TILES = 4;

  const rows = THEMES.map((t) => {
    const all = catalogue.filter((p) => p.theme === t);
    return {
      t,
      good: all.filter((p) => p.quality === "good").length,
      weak: all.filter((p) => p.quality === "weak").length,
      excl: all.filter((p) => p.quality === "exclude").length,
      total: all.length,
    };
  }).sort((a, b) => b.good - a.good);

  console.log("theme            good  weak  excl   total   columns");
  for (const r of rows) {
    const cols = Math.floor(r.good / TILES);
    console.log(
      `${r.t.padEnd(15)} ${String(r.good).padStart(4)}  ${String(r.weak).padStart(4)}  ` +
      `${String(r.excl).padStart(4)}  ${String(r.total).padStart(6)}   ${String(cols).padStart(5)}` +
      `${cols < 2 ? "  <- thin" : ""}`,
    );
  }

  const usable = rows.filter((r) => r.good >= TILES);
  const totalGood = catalogue.filter((p) => p.quality === "good").length;
  console.log(`\n${totalGood} good prompts - ${usable.length}/${THEMES.length} themes can fill a column of ${TILES}`);

  if (usable.length < BOARD_THEMES) {
    console.log(`NOT ENOUGH THEMES for a ${BOARD_THEMES}-column board`);
  } else {
    // A board draws 5 of the usable themes, so quoting the single thinnest theme
    // understates the pool badly. Report the total, and the worst case if the draw
    // keeps landing on the thinnest themes.
    const allBoards = Math.floor(totalGood / (BOARD_THEMES * TILES));
    const thinnest = [...usable].sort((a, b) => a.good - b.good).slice(0, BOARD_THEMES);
    const worstCase = Math.min(...thinnest.map((r) => Math.floor(r.good / TILES)));
    console.log(`${allBoards} full boards' worth of good prompts in total`);
    console.log(`worst-case draw (the ${BOARD_THEMES} thinnest themes): ${worstCase} board(s) before a prompt repeats`);
    const thin = rows.filter((r) => r.good < TILES * 2).map((r) => r.t);
    if (thin.length) console.log(`thin themes to grow or merge: ${thin.join(", ")}`);
  }
  console.log("\nwrote data/catalogue.json");
}

main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
