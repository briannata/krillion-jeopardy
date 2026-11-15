# krillion-jeopardy

A party-game website: a Jeopardy-shaped board of Krillion prompts. Pick a tile, everyone
answers at once, and points come from how *rare* your answer is. See [DESIGN.md](DESIGN.md).

## Data provenance

Prompt, answer and tier data comes from the **krilliongame.com** archive, an independent and
unaffiliated snapshot of **krillion.io**'s daily puzzle. Neither site is affiliated with this
project.

- The dataset is fetched **once**, locally, and `data/` is **gitignored** — it is not
  redistributed with this repo.
- Nothing is fetched at play time.
- `robots.txt` allows `User-agent: *`, but disallows named AI-training crawlers and signals
  `ai-train=no, use=reference`. The scraper identifies generically, waits 1.5s between
  requests, and never re-fetches a dive it already has.

## Pipeline

```bash
npm install
npm run scrape          # 122 dive pages -> data/raw/<date>.json   (resumable)
npm run build:dataset   # -> data/prompts/<id>.json + data/index.json
npm run stats           # dataset report: tier spread, thin prompts, duplicates
npm run apply:labels    # join labels/*.tsv onto the index -> data/catalogue.json
npm run test:matcher    # exercise answer matching against real data
```

`apply:labels` is also the label linter: it fails if any prompt is unlabelled, any label
points at a prompt that no longer exists, or any theme/quality value is unknown.

`npm run scrape -- --limit 5` fetches only the most recent dives (smoke test).
`npm run scrape -- --force` re-fetches dives already on disk.

## Layout

| path | what |
|---|---|
| `scripts/krillion.ts` | tiers, dive URLs, HTML→JSON extraction, polite fetch |
| `scripts/scrape.ts` | archive crawl into `data/raw/` |
| `scripts/build-dataset.ts` | normalize into per-prompt files + index |
| `scripts/apply-labels.ts` | join + validate labels, write the catalogue |
| `scripts/stats.ts` | dataset report |
| `labels/themes.tsv` | **committed** — hand-assigned theme per prompt |
| `labels/quality.tsv` | **committed** — hand-assigned weak/exclude calls, with reasons |
| `scripts/test-matcher.ts` | matcher checks against real answers |
| `src/normalize.ts` | **shared** answer normalization (builder + matcher must agree) |
| `src/matcher.ts` | server-side answer matching |

## Rules that matter

- **Answer lists never reach the client.** The matcher is server-side; a player submits text
  and receives only a score. Shipping a prompt's list to the browser puts the single
  100-point answer one devtools panel away.
- **`src/normalize.ts` is the single source of truth.** The builder bakes a normalized `key`
  into every stored answer; the matcher normalizes player input the same way. If the two
  drift, every lookup silently misses.
