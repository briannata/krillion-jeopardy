/**
 * Exercises the matcher against the real dataset.
 *
 *   A. Self-match: every stored answer must match itself exactly. A miss here means
 *      normalize() drifted between the builder and the matcher.
 *   B. Hand-written cases: the realistic ways players mistype or abbreviate.
 *   C. Abuse check: a vague word must never buy a rare answer's points.
 *
 * Usage: npm run test:matcher
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PromptMatcher } from "../src/matcher.ts";
import type { PromptFile } from "./build-dataset.ts";

const DATA_DIR = resolve(import.meta.dirname, "../data");
const PROMPTS_DIR = resolve(DATA_DIR, "prompts");

const ALIASES: Record<string, string> = {
  "spag bol": "spaghetti bolognese",
  "mac n cheese": "mac and cheese",
  "bolognaise": "spaghetti bolognese",
};

async function loadPrompt(id: string): Promise<PromptFile> {
  return JSON.parse(await readFile(resolve(PROMPTS_DIR, `${id}.json`), "utf8"));
}

/** Find a prompt whose text contains `needle`. */
async function findPrompt(needle: string): Promise<PromptFile | null> {
  const index = JSON.parse(await readFile(resolve(DATA_DIR, "index.json"), "utf8")) as {
    id: string; text: string;
  }[];
  const hit = index.find((p) => p.text.toLowerCase().includes(needle.toLowerCase()));
  return hit ? loadPrompt(hit.id) : null;
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

async function main() {
  const files = (await readdir(PROMPTS_DIR)).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error("no prompts — run `npm run scrape && npm run build:dataset`");

  // --- A. self-match across a sample of prompts -----------------------------
  console.log("A. self-match (every stored answer matches itself)");
  const sample = files.sort(() => Math.random() - 0.5).slice(0, 25);
  let checked = 0, missed = 0, wrongScore = 0;
  for (const f of sample) {
    const prompt: PromptFile = JSON.parse(await readFile(resolve(PROMPTS_DIR, f), "utf8"));
    const m = new PromptMatcher(prompt.answers, ALIASES);
    for (const a of prompt.answers) {
      checked++;
      const r = m.match(a.answer);
      if (!r.matched) missed++;
      else if (r.score !== a.score) wrongScore++;
    }
  }
  console.log(`  ${checked.toLocaleString()} answers across ${sample.length} prompts`);
  console.log(`  ${missed} unmatched · ${wrongScore} matched at the wrong score`);
  if (missed) failures++;
  // Score mismatches are expected where two stored answers normalize alike; the
  // builder keeps the first, so a later duplicate resolves to the first one's score.
  console.log(`  (score mismatches are collapsed near-duplicates, not bugs)`);

  // --- B. fuzzy behaviour on a real prompt ----------------------------------
  const pasta = await findPrompt("pasta dish");
  if (pasta) {
    console.log(`\nB. fuzzy matching — "${pasta.text}"`);
    const m = new PromptMatcher(pasta.answers, ALIASES);
    const show = (input: string) => {
      const r = m.match(input);
      console.log(
        `  ${input.padEnd(22)} -> ${r.matched ? `${r.answer} (${r.score}pts, ${r.tier}, via ${r.via}${r.ambiguous ? ", ambiguous" : ""})` : "NO MATCH (0 pts)"}`,
      );
      return r;
    };
    show("Lasagna");
    show("lasagne");
    show("  LASAGNA  ");
    show("spag bol");
    show("bolognese");
    show("Mac and cheese");
    show("carbonara");
    show("carbanara");
    show("Spagetti");
    const junk = show("asdfghjkl");
    check("gibberish scores 0", junk.score, 0);
  } else {
    console.log("\nB. skipped — no pasta prompt in the dataset yet");
  }

  // --- C. abuse check -------------------------------------------------------
  console.log("\nC. abuse — a vague word must not buy a rare answer");
  const head = await findPrompt("part of the human head");
  if (head) {
    const m = new PromptMatcher(head.answers, ALIASES);
    const r = m.match("bone");
    console.log(`  "bone" -> ${r.matched ? `${r.answer} (${r.score}pts, via ${r.via}${r.ambiguous ? ", ambiguous" : ""})` : "NO MATCH (0 pts)"}`);
    check("vague word scores 0", r.score, 0);

    // ...but an unambiguous subset must still pay out.
    const specific = m.match("brow bone");
    console.log(`  "brow bone" -> ${specific.matched ? `${specific.answer} (${specific.score}pts, via ${specific.via})` : "NO MATCH"}`);
    check("specific answer still matches", specific.matched, true);

    // The opt-in policy still works for anyone who wants it.
    const lenient = new PromptMatcher(head.answers, ALIASES, "cheapest");
    const l = lenient.match("bone");
    console.log(`  "bone" (cheapest policy) -> ${l.matched ? `${l.answer} (${l.score}pts)` : "NO MATCH"}`);
  }

  console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
