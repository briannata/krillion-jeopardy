/**
 * Shared types + helpers for the krilliongame.com archive.
 *
 * Data provenance: krilliongame.com publishes an independent, unaffiliated archive of
 * krillion.io's daily puzzle. Each dive page embeds the whole dive as one inline
 * <script type="application/json" id="krilling-practice-data"> blob.
 */

export const ARCHIVE_ORIGIN = "https://krilliongame.com";
export const DIVE_URL = (date: string) => `${ARCHIVE_ORIGIN}/krillion-answers/${date}/`;

/** Known Krillion tiers and their point values. */
export const TIER_POINTS = {
  plankton: 10,
  tooclever: 15,
  schooler: 30,
  rare: 60,
  deepcut: 85,
  krillion: 100,
} as const;

export type Tier = keyof typeof TIER_POINTS;
export const TIERS = Object.keys(TIER_POINTS) as Tier[];

/** Ascending by rarity — the order the board reveals answers in. */
export const TIER_ORDER: Tier[] = ["plankton", "tooclever", "schooler", "rare", "deepcut", "krillion"];

export interface RawAnswer {
  answer: string;
  score: number;
  tier: string;
}

export interface RawPrompt {
  id: string;
  text: string;
  answers: RawAnswer[];
}

export interface RawDive {
  date: string;
  dayNumber: number;
  prompts: RawPrompt[];
  dates?: { date: string; dayNumber: number }[];
}

const DATA_SCRIPT_RE =
  /<script[^>]*id=["']krilling-practice-data["'][^>]*>([\s\S]*?)<\/script>/i;

/** Pull the embedded dive JSON out of a dive page's HTML. */
export function extractDive(html: string): RawDive {
  const m = html.match(DATA_SCRIPT_RE);
  if (!m || !m[1]) throw new Error("no #krilling-practice-data script found in page");

  // The blob is raw JSON inside a <script type="application/json"> — no HTML entity
  // decoding is applied by the browser, so parse it as-is.
  const dive = JSON.parse(m[1].trim()) as RawDive;

  if (!dive.date || !Array.isArray(dive.prompts)) {
    throw new Error("embedded JSON is not a dive payload");
  }
  return dive;
}

/**
 * Generic client name on purpose: no personal details, no impersonation of a browser
 * or of a named crawler.
 */
export const USER_AGENT = "krillion-jeopardy-dataset/0.1 (personal, one-time archive fetch)";

export async function fetchText(url: string, attempt = 1): Promise<string> {
  const MAX_ATTEMPTS = 3;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
    });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) {
      // 404 and friends are terminal — don't burn retries on them.
      const err = new Error(`HTTP ${res.status}`) as Error & { terminal?: boolean };
      err.terminal = true;
      throw err;
    }
    return await res.text();
  } catch (err) {
    const terminal = (err as { terminal?: boolean }).terminal;
    if (terminal || attempt >= MAX_ATTEMPTS) throw err;
    // Back off hard: 3s, 9s.
    await sleep(3000 * 3 ** (attempt - 1));
    return fetchText(url, attempt + 1);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
