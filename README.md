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

## Running it

```bash
npm start     # server on http://localhost:8787  (ws://localhost:8787/ws)
npm run dev   # same, reloading on change
npm run smoke # end-to-end test against a running server
```

The server needs the dataset built first (see Pipeline below).

### HTTP

| route | what |
|---|---|
| `POST /api/rooms` | create a room, returns its 4-letter code |
| `GET /api/rooms/:code` | does this room exist, and what phase is it in |
| `GET /api/rooms/:code/catch/:promptId` | paged answer list — **only once the game is finished** |
| `GET /health` | liveness |

All gameplay runs over `WS /ws`. Message shapes live in `src/game/types.ts`.

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
| `src/game/types.ts` | the wire contract (client <-> server) |
| `src/game/board.ts` | board generation, theme weighting by depth |
| `src/game/engine.ts` | **pure** game state machine — no sockets, no timers |
| `src/server/room.ts` | room runtime: the clock, the sockets, matching |
| `src/server/catalogue.ts` | catalogue load + lazy per-prompt answer loading |
| `src/server/index.ts` | HTTP + WebSocket server |
| `scripts/test-engine.ts` | plays full games through the engine |
| `scripts/smoke-server.ts` | end-to-end test over real sockets |

## Rules that matter

- **Answer lists never reach the client.** The matcher is server-side; a player submits text
  and receives only a score. Shipping a prompt's list to the browser puts the single
  100-point answer one devtools panel away.
- **The engine is pure; the room is not.** `src/game/engine.ts` takes `now` and `rng`
  as arguments and touches no IO, so a 20-round game runs in a test in milliseconds and
  any bug reproduces from a seed. Timers and sockets live in `src/server/room.ts`.
- **The live prompt id is never sent to clients.** Only the prompt *text* is. The id
  alone would let a player look that prompt up on the archive site mid-round.
- **The Catch endpoint refuses until the game is `finished`**, and only serves prompts
  that room actually played. Without that it is a mid-game answer oracle.
- **`src/normalize.ts` is the single source of truth.** The builder bakes a normalized `key`
  into every stored answer; the matcher normalizes player input the same way. If the two
  drift, every lookup silently misses.
