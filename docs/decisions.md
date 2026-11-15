# Decisions

Short notes on choices that are not obvious from the code.

## Data

- **Percentiles are ranked on β recomputed from task labels**, not on the floats in `occ_level.csv`. The CSV stores
  Pharmacists as `0.39999999999999997` although its tasks give exactly `0.4`; ranking on the raw floats would put it
  "below" every other 0.4 occupation and shift Project Management Specialists from 64.1% to 64.2%. A unit test
  documents the artifact.
- **O\*NET Alternate Titles** (30.0) are imported for search; the task statements themselves come from the
  GPTs-are-GPTs dataset (O\*NET 27.2). Both are SOC-2019 based, so codes line up.
- `occupations.json` (~3 MB) is loaded once by the server and never shipped to the browser.

## Drills

- **One model call per drill**, returning the document and its answer key together as strict JSON. The key is then
  checked by code. Asking a second model to "find the mistakes" at serve time would double latency and add an
  opinion; a deterministic verifier is cheaper and testable.
- **Every "numbers" mistake must be proven** by an arithmetic check that our own evaluator recomputes. This is the
  strongest guarantee we can give without a human reviewer, and it makes the first "aha" indisputable — which is why
  the first drill always carries a numbers mistake.
- **Blind cross-check only for the pool.** It doubles the cost of a drill, so it runs where the drill will be seen by
  many people (the Daily Catch), not on every personal drill.
- **45-second wait budget.** A live drill usually takes 20–40 s. Past 45 s the user gets a verified pool drill and
  the live one, if it arrives, is kept for next time. The first drill is started when the tasks are picked, before
  the remaining scan questions, so it is normally ready.
- **Word limit has 15% slack** (`WORD_LIMIT_SLACK`): models count words loosely and the limit only exists to keep a
  drill near five minutes.
- **Claude answers through an optional tool call.** The current model rejects a forced `tool_choice`
  ("not supported for this model"), so the single tool is offered with `auto` and the system prompt tells the model
  to answer through it. An answer without the tool call is treated as malformed and takes the normal retry path.
- **Gemini runs in JSON mode with the schema in the prompt.** Its `responseSchema` dialect rejected our nested
  union schema with HTTP 400. The answer is validated by the same zod schema and verifier as any other draft.
- **Stringified nested fields are unwrapped before validation.** Models occasionally return `"brief": "{…}"`.
  That is a transport quirk, not a content problem, and should not cost a 30-second retry.
- **Three-minute cooldown after a failed live generation.** When a provider is down (or out of credit) the pool is
  served at once; live drills resume by themselves when the provider does.
- **Internal traffic never spends model budget.** Sessions from automated browsers or `/?internal=1` get pool drills
  and heuristic grading of their notes.
- **A dollar ceiling on model spend** (`LLM_BUDGET_USD`). Count limits do not see failed generations, and a rejected
  draft costs as much as an accepted one. The ceiling is computed from the ledger of model calls (token counts at
  list prices, timed-out calls at their ceiling), and a generation starts only while its worst case and that of
  every generation in flight still fit. At the ceiling the product serves the pool and grades with the heuristic.
- **The shared Daily Catch of an occupation without a pool is prepared ahead of time**: when a real person finishes
  the scan, and when their dashboard asks for today's status. Generating it on the click made the person wait a
  whole generation, and one rejected draft (about one in five on 2026-11-15) pushed that past the 45-second budget,
  which gave everyone in that occupation a drill from another occupation for the day.
- **Default model effort is kept.** Measured on 2026-11-15 with six drills at `medium` effort: a draft took about
  11 s instead of about 27 s, but only 2 of 6 first drafts passed the verifier (4 of 5 at the default that day),
  mostly because the key covered two mistake types instead of three. Time to an accepted drill did not improve.
- **Six Customer Service drills were written in the build session.** The model account ran out of credit during the
  pool run. They pass `verifyDrill` but were not cross-checked; `data/pool/stats.json` says so.

## Scoring

- **Hits are decided by code.** A model grades only the optional "why" note, once per attempt, with a 12 s budget and
  a keyword heuristic behind it. A slow or wrong grader can move a score by at most 6 points per mistake.
- **Elo against a level**, not against other players: it works from the first user and needs no population.
  Percentiles stay locked until there are 20 real players with at least 3 drills each.

## Product

- **Anonymous cookie sessions.** The jury must be able to walk the product without registering, and we collect no
  personal data.
- **Demo checkout without card fields.** It starts a 7-day trial on the session and records the funnel event; the
  banner says so. Stripe test mode was out of scope without keys.
- **The demo profile is produced by the real engine.** A scripted player (seeded PRNG) plays a week of pool drills
  through the same `submit`, scoring and Elo as any user, at every boot. Each visitor gets a private copy, shifted
  so its last day is yesterday, and can play today's Daily Catch.
- **Scanning from the demo profile starts a fresh session** rather than rewriting the demo data.
- **The demo player's seed was chosen, and says so.** The scripted week is deterministic; among a few dozen seeds we
  kept one whose week shows the intended arc clearly. The banner reads "Demo profile — simulated week".

## Engineering

- **Server-rendered pages use template strings with auto-escaping**, not React on the server: SEO pages, the public
  report and `/metrics` ship no JavaScript (the report has one copy button) and add no runtime dependency. They link
  the web app's compiled stylesheet via the Vite manifest, so tokens and fonts are shared.
- **No model SDKs.** Two small `fetch` clients behind one `StructuredProvider` interface keep the model replaceable
  and the Docker image small.
- **In-flight generations live in a `Map`.** One process, one replica, one SQLite file on a volume. Horizontal
  scaling would move this to a job table.
- **Deploys are triggered explicitly.** Railway builds the Dockerfile from the GitHub repository; in this project
  the push webhook did not fire, so a deploy is started after each push.
- **Internal traffic is excluded from metrics** by a cookie (`/?internal=1`) and by user agent (Playwright,
  headless Chrome, crawlers).
