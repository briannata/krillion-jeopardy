/**
 * data/raw/*.json  ->  data/prompts/<promptId>.json + data/index.json
 *
 * The server loads index.json at boot (small) and lazy-loads a prompt's answer file
 * only when that prompt is actually played. Answer files never reach the client.
 *
 * Usage: npm run build:dataset
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TIER_POINTS, TIERS, type RawDive, type Tier } from "./krillion.ts";
// Single source of truth — the live matcher imports this exact function.
import { normalize } from "../src/normalize.ts";

const DATA_DIR = resolve(import.meta.dirname, "../data");
const RAW_DIR = resolve(DATA_DIR, "raw");
const PROMPTS_DIR = resolve(DATA_DIR, "prompts");

export interface PromptAnswer {
  answer: string;
  /** Normalized form used for matching; see normalize(). */
  key: string;
  score: number;
  tier: Tier;
}

export interface PromptMeta {
  /** Stable id: d<dayNumber>-<promptId>, e.g. "d87-p1". */
  id: string;
  text: string;
  date: string;
  dayNumber: number;
  answerCount: number;
  tierCounts: Partial<Record<Tier, number>>;
  /** Highest-scoring answers (usually the single 100-pointer). */
  topAnswers: string[];
  /** Set when another prompt in the archive has the same normalized text. */
  duplicateOf?: string;
}

export interface PromptFile extends PromptMeta {
  answers: PromptAnswer[];
}

/** Collapse a stored tier string onto a known Tier, falling back by score. */
function toTier(raw: string, score: number): Tier | null {
  const t = raw.toLowerCase().replace(/[^a-z]/g, "") as Tier;
  if (TIERS.includes(t)) return t;
  const byScore = (Object.entries(TIER_POINTS) as [Tier, number][]).find(
    ([, pts]) => pts === score,
  );
  return byScore ? byScore[0] : null;
}

async function main() {
  await mkdir(PROMPTS_DIR, { recursive: true });
  // Rebuild from scratch so stale prompt files can't linger.
  await rm(PROMPTS_DIR, { recursive: true, force: true });
  await mkdir(PROMPTS_DIR, { recursive: true });

  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error("data/raw is empty — run `npm run scrape` first");

  const index: PromptMeta[] = [];
  const seenText = new Map<string, string>(); // normalized prompt text -> first prompt id
  const unknownTiers = new Map<string, number>();
  const tierTotals = new Map<Tier, number>();
  let totalRows = 0;
  let droppedRows = 0;
  let dupeAnswerRows = 0;

  for (const file of files) {
    const dive = JSON.parse(await readFile(resolve(RAW_DIR, file), "utf8")) as RawDive;

    for (const prompt of dive.prompts) {
      const id = `d${dive.dayNumber}-${prompt.id}`;
      const answers: PromptAnswer[] = [];
      const seenKey = new Set<string>();
      const tierCounts: Partial<Record<Tier, number>> = {};

      for (const raw of prompt.answers) {
        totalRows++;
        const tier = toTier(raw.tier, raw.score);
        if (!tier) {
          droppedRows++;
          unknownTiers.set(raw.tier, (unknownTiers.get(raw.tier) ?? 0) + 1);
          continue;
        }
        const key = normalize(raw.answer);
        if (!key) { droppedRows++; continue; }

        // Two stored answers can normalize to the same key ("T-Rex" / "T Rex").
        // Keep the first; a player typing either should match once.
        if (seenKey.has(key)) { dupeAnswerRows++; continue; }
        seenKey.add(key);

        answers.push({ answer: raw.answer, key, score: raw.score, tier });
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
        tierTotals.set(tier, (tierTotals.get(tier) ?? 0) + 1);
      }

      const maxScore = answers.reduce((m, a) => Math.max(m, a.score), 0);
      const meta: PromptMeta = {
        id,
        text: prompt.text,
        date: dive.date,
        dayNumber: dive.dayNumber,
        answerCount: answers.length,
        tierCounts,
        topAnswers: answers.filter((a) => a.score === maxScore).map((a) => a.answer).slice(0, 5),
      };

      const textKey = normalize(prompt.text);
      const firstSeen = seenText.get(textKey);
      if (firstSeen) meta.duplicateOf = firstSeen;
      else seenText.set(textKey, id);

      index.push(meta);
      const payload: PromptFile = { ...meta, answers };
      await writeFile(resolve(PROMPTS_DIR, `${id}.json`), JSON.stringify(payload), "utf8");
    }
  }

  index.sort((a, b) => b.dayNumber - a.dayNumber || a.id.localeCompare(b.id));
  await writeFile(resolve(DATA_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");

  const dupes = index.filter((p) => p.duplicateOf).length;
  console.log(`dives            ${files.length}`);
  console.log(`prompts          ${index.length}  (${dupes} duplicate prompt texts)`);
  console.log(`answer rows      ${totalRows} read · ${totalRows - droppedRows - dupeAnswerRows} kept`);
  console.log(`  dropped        ${droppedRows} (unknown tier / empty after normalize)`);
  console.log(`  near-dupes     ${dupeAnswerRows} (normalized to an existing answer)`);
  console.log(`\ntier totals across the archive:`);
  for (const t of TIERS) {
    const n = tierTotals.get(t) ?? 0;
    const promptsWith = index.filter((p) => (p.tierCounts[t] ?? 0) > 0).length;
    console.log(
      `  ${t.padEnd(10)} ${String(TIER_POINTS[t]).padStart(3)}pts  ${String(n).padStart(9)} rows  in ${promptsWith}/${index.length} prompts`,
    );
  }
  if (unknownTiers.size) {
    console.log(`\nunrecognised tier labels:`);
    for (const [t, n] of unknownTiers) console.log(`  ${JSON.stringify(t)} x${n}`);
  }
  console.log(`\nwrote data/index.json and data/prompts/*.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
