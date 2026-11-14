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

## Engineering

- **Server-rendered pages use template strings with auto-escaping**, not React on the server: SEO pages, the public
  report and `/metrics` ship no JavaScript (the report has one copy button) and add no runtime dependency. They link
  the web app's compiled stylesheet via the Vite manifest, so tokens and fonts are shared.
- **No model SDKs.** Two small `fetch` clients behind one `StructuredProvider` interface keep the model replaceable
  and the Docker image small.
- **In-flight generations live in a `Map`.** One process, one replica, one SQLite file on a volume. Horizontal
  scaling would move this to a job table.
- **Internal traffic is excluded from metrics** by a cookie (`/?internal=1`) and by user agent (Playwright,
  headless Chrome, crawlers).
