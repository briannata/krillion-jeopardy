# Krillion Jeopardy — design

A party-game website: a Jeopardy-shaped board of Krillion prompts. You pick a tile, everyone
answers at once, and points come from how *rare* your answer is, not whether it's "right".

> Source note: prompt/answer/tier data comes from the krilliongame.com archive, which is an
> independent, unaffiliated snapshot of krillion.io's daily puzzle. This build is private/unlisted
> and credits krillion.io. No scraping happens at play time. krillion.io also ships its own party
> mode ("Puffer Party", in beta) — this is a different format, not a competitor.

## Decided

### Board & game shape
- **Tile = one prompt.** Columns are *themes* (Geography, Animals, Food, Pop Culture…), each tile
  under a theme is a different Krillion prompt.
- **5 categories × 4 tiles = 20 rounds.** ~10–12 minutes.
- Board generation: 5 random themes, 4 random prompts each, **no repeats within a room** across games.
- The ~854 archived prompts are the "krillion questions per category" pool.

### Scoring
- **Stored Krillion tiers, used as-is.** Plankton 10 · Too Clever 15 · Schooler 30 · Rare 60 ·
  Deep Cut 85 · One in a Krillion 100. No answer / no match = **0**.
- Every tile is worth the same *a priori*; realized value is 0–100 by your answer's rarity.
- **Duplicates score independently** — two players saying "Lasagna" both get 10. Ties are accepted.
- Depth metaphor: **points × 10 = metres**. A perfect game is 20,000m.

### Round flow
1. Picker chooses a tile. The tile is **blank** until picked — only the theme name is visible.
   Picking is **pure control**: no head start, no multiplier.
2. Prompt revealed to everyone. **~30s timer.** Answers are editable until you lock in or time
   expires; locking early shows a "locked" indicator. Last text at zero counts.
3. **Reveal batched by tier**, ascending (Plankton → One in a Krillion). All players in a tier flip
   together. Bounded at ~6 flips per round regardless of player count — this is what makes
   "no player limit" work.
4. Scores update. **No answers are revealed during the game** beyond what players said.

### Turn order
- **Picker = last round's winner.** Ties (which will be common) are **resolved randomly** among the
  tied players.

### Session
- Classic Jackbox: **4-letter room code**, **no player limit**.
- Rejoin by code + name, score preserved. State is in server memory only; nothing persists after
  the game.

### End of game
- Board clears → final scoreboard using dive depth.
- Then **"The Catch"**: all 20 prompts, tap one to expand its full answer list — modelled on
  krillion.io's archive view: **tier filter chips** with counts (All / Krillion / Deep Cut / Rare /
  Schooler / Plankton), a **search box**, and a virtualized list loading ~100 at a time.
- Each prompt's list is **lazy-loaded on expand** and paginated — nothing ships until opened.
- ⚠️ krillion.io shows "37,591 other players chose this". **The archive stores no player counts**,
  so that line cannot be reproduced. Don't design around it.

### Look
Same deep-sea concept — depth, metres, rarity-as-descent — in our own type, palette and layout.
A tribute, not a copy.

## Themes

All 854 prompts are hand-labelled into 16 themes in `labels/themes.tsv` (committed), joined
onto the scraped index by `npm run apply:labels`, which refuses to run if a single prompt is
unlabelled or carries an unknown theme.

The rule is **domain, not answer type**: "Name a rapper" is `music`, "Name a famous physicist"
is `science-space`. `people` is only for prompts where fame itself is the category.

| theme | good | columns of 4 |
|---|---|---|
| geography | 118 | 29 |
| everyday | 105 | 26 |
| food-drink | 94 | 23 |
| animals | 72 | 18 |
| screen | 68 | 17 |
| sports | 46 | 11 |
| science-space | 40 | 10 |
| history-belief | 34 | 8 |
| words-books | 32 | 8 |
| gaming | 28 | 7 |
| music | 26 | 6 |
| tech | 25 | 6 |
| brands | 24 | 6 |
| body-health | 23 | 5 |
| arts | 10 | 2 |
| people | 6 | 1 |

**751 of 854 prompts are board-ready — 37 full boards' worth.** Every theme can fill a column.

### Quality
`good` / `weak` / `exclude`, from two sources:

- **Hand calls** in `labels/quality.tsv`, with a reason on every row: dated prompts ("a movie
  first released in 2026", "current NBA roster"), expert niches (Fortune 500 CEOs, Tranco
  rankings), and one `exclude` — the self-referential prompt about spelling words from
  "krillion".
- **Computed rules**, because they are measurements not judgements: >20,000 answers is too
  broad, >95% of answers in one tier has no gradient, <12 answers is too thin, and anything
  flagged as a duplicate prompt.

### Known gap
`people` has only 6 good prompts — one column, so a room draws it at most once before it
repeats. Either merge it (internet-fame prompts into `tech`, comedians into `screen`) or have
board generation weight themes by depth. `arts` at 2 columns is the next thinnest.

## Architecture

- **Node + TypeScript, single process, WebSockets.** Authoritative game state in memory, keyed by
  room code. Vite + React client. Deploy to Fly/Railway/Render.
- **Answer matching is server-side only.** The client never receives answer lists during play —
  it submits text and gets back a score. This is the one hard rule: shipping a prompt's list to the
  browser puts the 100-pointer in devtools.
- No database. Room state is ephemeral.

## Data

Each archive dive page embeds the whole dive as one inline blob:
`<script type="application/json" id="krilling-practice-data">` (~1.6MB), shaped:

```json
{ "date": "2026-10-10", "dayNumber": 87,
  "prompts": [ { "id": "p1", "text": "Name a musical instrument",
                 "answers": [ { "answer": "Daxophone", "score": 100, "tier": "krillion" } ] } ] }
```

122 dives × 7 prompts ≈ **854 prompts**, roughly 1M+ answer rows.

### Tier distribution — measured across the full archive
854 prompts, 1,206,243 answer rows (122 dives, zero fetch failures).

| tier | pts | rows | share | prompts containing it |
|---|---|---|---|---|
| Plankton | 10 | 4,363 | 0.4% | 854 / 854 |
| Too Clever | 15 | 522 | 0.0% | 329 / 854 |
| Schooler | 30 | 17,149 | 1.4% | 852 / 854 |
| Rare | 60 | 71,957 | 6.0% | 854 / 854 |
| Deep Cut | 85 | 1,111,212 | **92.1%** | 850 / 854 |
| One in a Krillion | 100 | 1,040 | 0.1% | 836 / 854 |

**The 85-wall is far milder per prompt than the row totals suggest.** That 92.1% is dominated
by a handful of enormous prompts (the largest has 100,739 answers). Per prompt:

| | share of that prompt's answers at 85 |
|---|---|
| p10 | 20.3% |
| p25 | 36.5% |
| **p50** | **62.0%** |
| p75 | 85.6% |
| p90 | 93.7% |

So the median prompt has a real gradient and the typical board will play fine. Pick prompts for
the board from the *thinner* half and the wall mostly disappears — that is a board-generation
lever, not a scoring change.

**"Too Clever" (15 pts) does exist** — 522 rows in 329 prompts. An earlier two-dive sample
missed it. All six tiers are live.

### Answer-list size
| | answers |
|---|---|
| min | 8 |
| p10 | 32 |
| **median** | **164** |
| p90 | 2,620 |
| max | 100,739 |

353 prompts have fewer than 100 answers. The thinnest are letter/geography constraints
("Name a country whose name starts with I" — 9 answers), which are good tight party prompts.

### Board suitability
- **0 prompts lack a 10-point answer** — every prompt has an accessible entry point.
- 18 prompts have no 100-pointer; 203 have more than one.
- Only **1** repeated prompt text in the whole archive.

### Pipeline (build first)
1. Fetch all 122 dive pages once, extract the inline JSON, normalize.
2. Store per-prompt files + an index (id, text, date, answer count, tier counts).
3. **LLM-label each prompt offline** with a theme + a quality flag; commit the labels and review by
   hand. Catches junk like "Name a 3+ letter word you can spell with the letters in KRILLION".
4. Build the matcher and test it against real answer text.

### Matching
Normalize both sides: lowercase → strip diacritics → strip punctuation → collapse whitespace →
drop leading articles → singularize. Exact match on the normalized form first, then bounded edit
distance for typos (≤1 for short strings, ≤2 for long). An alias table handles the obvious cases
("spag bol", "bolognese"). **No match = 0 points**, surfaced plainly — the archive openly admits it
is not exhaustive, so some genuinely valid answers will score 0.

## Server (built)

- **Pure engine / impure room.** `src/game/engine.ts` is a state machine taking `now`
  and `rng` as arguments; `src/server/room.ts` owns the clock, the sockets and the
  matcher. Rule bugs are testable without a socket; timing bugs are confined to one file.
- **Phases:** `lobby -> picking -> answering -> revealing -> (picking | finished)`.
- **Reveal batching** groups players by tier and plays surface-to-deep, misses first.
  At most 7 steps per round no matter how many players, which is what makes
  "no player limit" compatible with a one-at-a-time reveal.
- **Picker** is the previous round's top scorer, chosen at random among ties, falling
  back to the host if that player has dropped.
- **Board generation weights themes by remaining depth**, and skips any theme that can
  no longer fill a column. This is the fix for thin `people` — measured at geography
  278x vs people 21x across 400 boards, and 36 boards per room before the pool dries up.
- **Reconnection** is by token: same player id, score preserved, one socket per player.
- **Rooms** are in-memory, 4-letter codes from a 24-letter alphabet with I/O/0/1 removed,
  swept after 2h idle.

### Verified
- `npm run test:engine` — board generation, 36 non-repeating boards per room, thin-theme
  weighting, a full 20-round game, reveal ordering, reconnection.
- `npm run smoke` — real sockets: a correct answer scored its stored tier ("Ice hockey",
  10pts, Plankton), gibberish scored 0, the round winner took the next pick, drafts never
  reached the other player, largest frame 2.3KB, and The Catch returned 403 mid-game.

## Client (built)

Vite + React + TypeScript, one bundle serving two surfaces: the player client at
`/` (phone-first) and the shared display at `/?host=CODE`.

- **The host screen attaches with `watch`** — a display-only connection added to
  the server for this. It sees state, never joins the scoreboard, never sends an
  intent.
- **Becoming the screen is a button, not a URL to know.** "Use this device as the
  screen" on the join screen watches the typed code, or opens a room first when
  the field is empty — the TV-first order, where the screen goes up and the
  phones join the code it shows. Because the screen does not join, the first
  phone to arrive is still the host. The lobby also offers it, for casting a
  room started from a phone. A bad or expired code gets an error and a way back
  rather than a blank display.
- **Reconnection** is by a token kept in sessionStorage per room, so a refresh
  rejoins as the same player with the same score.
- **Drafts are debounced to the server** (~220ms) so a reconnect keeps what you
  typed without a frame per keystroke.
- **The countdown renders from the server's deadline**, not a local timer, so a
  slow client cannot drift into answering after time is up.
- Palette and motion live in `src/client/tokens.css`. Tier colour is looked up
  from points in `ui.tsx` — no screen hardcodes a tier hex.

### Verified by playing it
Created a room, joined, started, picked a tile ("Name a mammal with stripes"),
answered "Okapi" — scored 30, Schooler, 300m — the played tile then showed its
prompt, and the host screen tracked every step in sync.

## Open / deferred
- Reveal pacing when one tier holds nearly everyone — needs a feel pass once playable.
  Less urgent than feared: the median prompt is only 62% Deep Cut.
- `people` (6 good prompts) and `arts` (10) are thin — merge or weight them in board generation.
- Board generation should prefer prompts with a real tier gradient (and probably cap
  answer-list size) rather than sampling all 854 uniformly.
- Alias table is a stub (3 entries). Grow it from what players actually type.
- The reveal advances on the server's timer; the client has no skip control yet
  (the host `advance` message exists but nothing calls it).
- Rooms are in-memory only: a server restart drops every game in progress.

## Resolved during the build
- **"Too Clever" exists.** All six tiers are live; no tier needs special-casing.
- **All 854 prompts are themed and quality-flagged**, validated on every run. 751 are
  board-ready, enough for 37 boards without repeating a prompt.
- **Ambiguous subset matches score 0.** Typing "bone" for *a part of the human head* matched
  `Brow bone` for 60 points under a cheapest-candidate rule. A word that fits many stored
  answers is not a specific answer, so it now scores nothing; "brow bone" still pays.
  The lenient policy survives as an opt-in constructor argument.
