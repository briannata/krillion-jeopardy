/**
 * One-time fetch of the krilliongame.com dive archive into data/raw/.
 *
 * Polite by construction:
 *   - generic client name, no personal details
 *   - DELAY_MS between requests, single connection, never parallel
 *   - resumable: a dive already on disk is never re-fetched
 *
 * Usage:
 *   npm run scrape              # fetch every dive listed in the archive
 *   npm run scrape -- --limit 5 # fetch only the 5 most recent (smoke test)
 *   npm run scrape -- --force   # re-fetch dives already on disk
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DIVE_URL, extractDive, fetchText, sleep, type RawDive } from "./krillion.ts";

const RAW_DIR = resolve(import.meta.dirname, "../data/raw");
const DELAY_MS = 1500;

/** The archive index — and every dive page — carries the full list of dates. */
const SEED_DATE = "2026-10-10";

function parseArgs(argv: string[]) {
  const limit = argv.includes("--limit")
    ? Number(argv[argv.indexOf("--limit") + 1])
    : Infinity;
  return { limit, force: argv.includes("--force") };
}

async function discoverDates(): Promise<{ date: string; dayNumber: number }[]> {
  const html = await fetchText(DIVE_URL(SEED_DATE));
  const dive = extractDive(html);
  if (!dive.dates?.length) throw new Error("seed dive carried no `dates` list");
  // Newest first, as published.
  return dive.dates;
}

async function main() {
  const { limit, force } = parseArgs(process.argv.slice(2));
  await mkdir(RAW_DIR, { recursive: true });

  const onDisk = new Set(
    (await readdir(RAW_DIR).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "")),
  );

  console.log("discovering dives…");
  const all = await discoverDates();
  const targets = all.slice(0, limit === Infinity ? undefined : limit);
  const todo = force ? targets : targets.filter((d) => !onDisk.has(d.date));

  console.log(
    `${all.length} dives listed · ${targets.length} targeted · ${onDisk.size} already on disk · ${todo.length} to fetch`,
  );
  if (!todo.length) return;

  let ok = 0;
  const failures: { date: string; error: string }[] = [];

  for (const [i, { date, dayNumber }] of todo.entries()) {
    const label = `[${String(i + 1).padStart(3)}/${todo.length}] ${date} (dive #${dayNumber})`;
    try {
      const html = await fetchText(DIVE_URL(date));
      const dive = extractDive(html);

      // Trim the repeated 122-entry `dates` list from every file; it is index data,
      // not dive data, and it would be duplicated 122 times on disk.
      const { dates: _dates, ...rest } = dive;
      const payload = rest as RawDive;

      const rows = payload.prompts.reduce((n, p) => n + p.answers.length, 0);
      await writeFile(
        resolve(RAW_DIR, `${date}.json`),
        JSON.stringify(payload),
        "utf8",
      );
      ok++;
      console.log(`${label} · ${payload.prompts.length} prompts · ${rows} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ date, error: msg });
      console.warn(`${label} · FAILED: ${msg}`);
    }
    if (i < todo.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\ndone · ${ok} fetched · ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ${f.date}: ${f.error}`);
    console.log("re-run `npm run scrape` to retry just the failures.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
