/**
 * Dataset report — answers the questions DESIGN.md leaves open:
 *   - does the 15-point "Too Clever" tier exist anywhere?
 *   - how lopsided is the 85-point wall, archive-wide?
 *   - which prompts are too thin / too brutal to put on a board?
 *
 * Usage: npm run stats
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TIERS, TIER_POINTS, type Tier } from "./krillion.ts";
import type { PromptMeta } from "./build-dataset.ts";

const INDEX = resolve(import.meta.dirname, "../data/index.json");

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) + "%" : "—");

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[i]!;
}

async function main() {
  const index = JSON.parse(await readFile(INDEX, "utf8")) as PromptMeta[];
  const live = index.filter((p) => !p.duplicateOf);
  const rows = (p: PromptMeta) => p.answerCount;
  const totalRows = index.reduce((n, p) => n + rows(p), 0);

  console.log(`=== archive ===`);
  console.log(`prompts            ${index.length} (${live.length} unique texts)`);
  console.log(`answer rows        ${totalRows.toLocaleString()}`);

  console.log(`\n=== tiers ===`);
  for (const t of TIERS) {
    const n = index.reduce((s, p) => s + (p.tierCounts[t] ?? 0), 0);
    const inPrompts = index.filter((p) => (p.tierCounts[t] ?? 0) > 0).length;
    const flag = n === 0 ? "   <- ABSENT from the entire archive" : "";
    console.log(
      `${t.padEnd(10)} ${String(TIER_POINTS[t]).padStart(3)}pts  ${String(n).padStart(9)} rows  ${pct(n, totalRows).padStart(6)}  in ${inPrompts}/${index.length} prompts${flag}`,
    );
  }

  console.log(`\n=== the 85-point wall, per prompt ===`);
  const wallShare = index
    .map((p) => (p.tierCounts.deepcut ?? 0) / Math.max(1, rows(p)))
    .sort((a, b) => a - b);
  for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    console.log(`  p${String(q * 100).padStart(2)}  ${(quantile(wallShare, q) * 100).toFixed(1)}% of a prompt's answers are Deep Cut`);
  }

  console.log(`\n=== answer-list size ===`);
  const sizes = index.map(rows).sort((a, b) => a - b);
  for (const q of [0, 0.1, 0.5, 0.9, 1]) {
    console.log(`  p${String(q * 100).padStart(3)}  ${quantile(sizes, q).toLocaleString()} answers`);
  }

  console.log(`\n=== board suitability ===`);
  const thin = index.filter((p) => rows(p) < 100);
  const noEasy = index.filter((p) => (p.tierCounts.plankton ?? 0) === 0);
  const noTop = index.filter((p) => (p.tierCounts.krillion ?? 0) === 0);
  const multiTop = index.filter((p) => (p.tierCounts.krillion ?? 0) > 1);
  console.log(`  < 100 answers (thin)          ${thin.length}`);
  console.log(`  no 10-pt answer (brutal)      ${noEasy.length}`);
  console.log(`  no 100-pt answer              ${noTop.length}`);
  console.log(`  more than one 100-pt answer   ${multiTop.length}`);

  if (thin.length) {
    console.log(`\n  thinnest prompts:`);
    for (const p of [...thin].sort((a, b) => rows(a) - rows(b)).slice(0, 8)) {
      console.log(`    ${String(rows(p)).padStart(4)}  ${p.text.slice(0, 70)}`);
    }
  }

  const dupes = index.filter((p) => p.duplicateOf);
  if (dupes.length) {
    console.log(`\n=== repeated prompt texts (${dupes.length}) ===`);
    for (const p of dupes.slice(0, 8)) {
      console.log(`  ${p.id} repeats ${p.duplicateOf}: ${p.text.slice(0, 60)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
