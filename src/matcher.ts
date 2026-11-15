/**
 * Answer matching. Runs on the SERVER ONLY — a prompt's answer list must never be
 * sent to a client, or the 100-pointer is one devtools panel away.
 *
 * Strategy, strictly in order. The first rule that hits wins, so an exact answer can
 * never be stolen by a looser rule:
 *
 *   1. exact    normalized text is identical
 *   2. alias    a hand-maintained shorthand ("spag bol")
 *   3. plural   trivial singular/plural variance
 *   4. typo     bounded edit distance, must be an unambiguous best
 *   5. subset   every word typed appears in the stored answer ("bolognese")
 *
 * Rule 5 is the abusable one: "bone" is a subset of Brow bone, Cheek bone, Nasal bone…
 * A word that fits many stored answers is not a specific answer, so an AMBIGUOUS subset
 * match scores nothing. Only an unambiguous one ("bolognese" -> Spaghetti bolognese)
 * counts. The alternative — awarding the cheapest candidate — still handed out 60 points
 * for typing "bone", which is exactly the exploit this rule has to avoid.
 */

import { normalize } from "./normalize.ts";

export type MatchVia = "exact" | "alias" | "plural" | "typo" | "subset";

export interface MatchableAnswer {
  answer: string;
  key: string;
  score: number;
  tier: string;
}

export type AmbiguousPolicy = "reject" | "cheapest";

export interface MatchResult {
  matched: boolean;
  /** The stored answer as published, for display on the reveal. */
  answer?: string;
  score: number;
  tier?: string;
  via?: MatchVia;
  /** True when rule 5 had to disambiguate; useful for tuning. */
  ambiguous?: boolean;
}

const NO_MATCH: MatchResult = { matched: false, score: 0 };

/** Singular/plural variants of a normalized key, cheapest first. */
function variants(key: string): string[] {
  const out = new Set<string>();
  const last = key.split(" ").pop() ?? "";
  const swapLast = (w: string) => {
    const parts = key.split(" ");
    parts[parts.length - 1] = w;
    return parts.join(" ");
  };
  if (last.endsWith("ies")) out.add(swapLast(last.slice(0, -3) + "y"));
  if (last.endsWith("es")) out.add(swapLast(last.slice(0, -2)));
  if (last.endsWith("s")) out.add(swapLast(last.slice(0, -1)));
  if (last.endsWith("y")) out.add(swapLast(last.slice(0, -1) + "ies"));
  out.add(swapLast(last + "s"));
  out.add(swapLast(last + "es"));
  out.delete(key);
  return [...out];
}

/** Edit distance with an early bail-out once it provably exceeds `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Typo budget: tight on short words so "cell" can't become "cello". */
function typoBudget(key: string): number {
  if (key.length <= 4) return 0;
  if (key.length <= 8) return 1;
  return 2;
}

export class PromptMatcher {
  private readonly byKey = new Map<string, MatchableAnswer>();
  private readonly byWord = new Map<string, MatchableAnswer[]>();
  private readonly keys: string[];

  constructor(
    answers: MatchableAnswer[],
    private readonly aliases: Record<string, string> = {},
    /**
     * What to do when several stored answers contain every word typed.
     * "reject"   — score 0; a vague word is not an answer (default)
     * "cheapest" — award the lowest-scoring candidate
     */
    private readonly ambiguousPolicy: AmbiguousPolicy = "reject",
  ) {
    for (const a of answers) {
      if (!this.byKey.has(a.key)) this.byKey.set(a.key, a);
      for (const w of new Set(a.key.split(" "))) {
        const bucket = this.byWord.get(w);
        if (bucket) bucket.push(a);
        else this.byWord.set(w, [a]);
      }
    }
    this.keys = [...this.byKey.keys()];
  }

  match(input: string): MatchResult {
    const key = normalize(input);
    if (!key) return NO_MATCH;

    const hit = (a: MatchableAnswer, via: MatchVia, ambiguous?: boolean): MatchResult => ({
      matched: true,
      answer: a.answer,
      score: a.score,
      tier: a.tier,
      via,
      ...(ambiguous ? { ambiguous } : {}),
    });

    // 1. exact
    const exact = this.byKey.get(key);
    if (exact) return hit(exact, "exact");

    // 2. alias
    const aliased = this.aliases[key];
    if (aliased) {
      const a = this.byKey.get(normalize(aliased));
      if (a) return hit(a, "alias");
    }

    // 3. plural / singular
    for (const v of variants(key)) {
      const a = this.byKey.get(v);
      if (a) return hit(a, "plural");
    }

    // 4. typo — require a single unambiguous nearest answer
    const budget = typoBudget(key);
    if (budget > 0) {
      let best: MatchableAnswer | null = null;
      let bestDist = budget + 1;
      let tied = false;
      for (const candidate of this.keys) {
        if (Math.abs(candidate.length - key.length) > budget) continue;
        const d = boundedLevenshtein(key, candidate, budget);
        if (d > budget) continue;
        if (d < bestDist) {
          bestDist = d;
          best = this.byKey.get(candidate)!;
          tied = false;
        } else if (d === bestDist) {
          tied = true;
        }
      }
      if (best && !tied) return hit(best, "typo");
    }

    // 5. word-subset containment, cheapest candidate wins
    const words = [...new Set(key.split(" "))].filter(Boolean);
    if (words.length) {
      // Start from the rarest word's bucket to keep this small.
      const buckets = words.map((w) => this.byWord.get(w) ?? []);
      if (buckets.some((b) => b.length === 0)) return NO_MATCH;
      const smallest = buckets.reduce((a, b) => (a.length <= b.length ? a : b));
      const candidates = smallest.filter((a) => {
        const aw = new Set(a.key.split(" "));
        return words.every((w) => aw.has(w));
      });
      if (candidates.length === 1) return hit(candidates[0]!, "subset");
      if (candidates.length > 1) {
        if (this.ambiguousPolicy === "reject") return NO_MATCH;
        const cheapest = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
        return hit(cheapest, "subset", true);
      }
    }

    return NO_MATCH;
  }
}
