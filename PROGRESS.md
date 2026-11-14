# PROGRESS — Overrule (Business Cup 2.0)

Working memory for the build. Updated after every milestone.

- Prod: https://overrule-production.up.railway.app
- Repo: https://github.com/gennadiy0041/overrule
- Railway: project `business-cup-demo`, service `overrule` (`ab5e6d03-de53-4911-9d1c-5cdc9cdbcc0a`), volume `/data`, autodeploy on push to `main`
- Deadline: final package by 2026-11-15 11:00 Astana (form closes 12:00)

## P0

- [x] Data import: 923 occupations, 19,265 tasks, 48,532 alternate titles
- [x] `exposure` engine + test reproducing `human_rating_beta` for all 923 occupations
- [x] Railway deploy, volume, variables (key references to `demo`), `/api/health`
- [x] Public GitHub repo
- [ ] Engine: safeMath, verifyDrill, scoring, elo, adaptive, daily (workflow 1, in progress)
- [ ] LLM layer: Claude → retry → Gemini → pool (workflow 1, in progress)
- [ ] Drill pool for 6 starter occupations (workflow 1, in progress)
- [ ] API: occupations, scan, map, drills, submit, me, checkout, events
- [ ] Web: landing → scan → map → drill → result → paywall → demo checkout → dashboard
- [ ] README draft

## P1

- [ ] Daily Catch + share grid, streak, `.ics`
- [ ] Demo profile (seeded through the real engine), Weekly Debrief, Review Report
- [ ] SEO pages + sitemap, /about, /metrics, /survey + micro-survey
- [ ] Limits, pool cross-check, mobile polish
- [ ] e2e against prod, CI, final README, docs/defense-ru.md

## P2 (only if P0+P1 green by 04:00)

- [ ] Second Look, dynamic OG image, PWA

## Pitch package

- [ ] Deck PDF (≤10 slides, real screenshots), pitch script (5 and 3 min), Q&A, demo video, LinkedIn post

## Decision log

- 20:20 Repo lives in `overrule/` next to the prompt file; the prompt (with the selftest token) stays outside the repo.
- 20:25 Percentiles are ranked on β recomputed from task labels, not on the floats in `occ_level.csv`:
  the CSV stores Pharmacists as 0.39999999999999997, which shifts Project Management Specialists
  from 64.1% to 64.2%. We show the exact value (64.1%) and a unit test documents the artifact.
- 20:30 O*NET Alternate Titles (30.0, CC BY 4.0) downloaded and imported for job-title search.
- 20:32 `METRICS_TOKEN` generated locally into `.local/metrics-token.txt` (git-ignored) and set on Railway via CLI.
- 20:35 Server-rendered pages use plain template strings with escaping (no React on the server): fewer runtime deps.

## HANDOFF — session 1 stopped early (usage limit reached)

**State of the tree: work in progress. The server does not boot yet** — it imports engine / LLM modules that
the parallel agents had not all finished when the session stopped. The work is committed on local `main` and
pushed to the remote branch `wip/session-1`. Remote `main` and prod are still the scaffold (`/api/health` only),
so nothing broken was deployed.

Done and verified
- Tooling and access (gh, Railway CLI linked to service `overrule`, Bun, Playwright Chromium, ffmpeg).
- Data import, `exposure` engine, unit test reproducing published beta for all 923 occupations.
- Railway service `overrule`: volume `/data`, healthcheck, variables (key references), domain; prod answers 200.

Written by the lead; type-checks except for imports of modules the agents were still writing
- `src/shared/api.ts` (the HTTP contract), `src/shared/pricing.ts`
- `src/server`: env, db (migrations), bootstrap, app, session, http, occupationStore, `repos/*`,
  `services/{drillService,pool,attemptResult,debrief,profile,exposureMap}`,
  `routes/{occupations,scan,drills,account,events}`, `ssr/{html,layout}`
- `src/web`: `styles.css` (design tokens), `ui/` kit, `lib/api`, `lib/format`, `App.tsx` (router, lazy routes)

In flight when stopped — three workflows, all stopped; their files may be partial, review before trusting
- W1 `overrule-engine-llm` (run `wf_b58b0773-832`): engine safeMath / verifyDrill / scoring / whyHeuristic / share /
  elo / adaptive / daily / search with tests; LLM layer `src/server/llm/*`; `scripts/llm-smoke.ts`,
  `scripts/generate-pool.ts`; `data/short-task-names.json`, `data/modern-titles.json`, `data/ATTRIBUTION.md`.
  The review phase and the pool generation had not run.
- W2 `overrule-pages-1` (run `wf_8f3ff3ff-e1a`): Landing, Scan, ExposureMap, About, Survey; `src/server/ssr/seoPages.ts`.
- W3 `overrule-pages-2` (run `wf_44bf5f31-b1e`): Drill + Result, StartDrill + Paywall + Checkout, Dashboard.
- The workflow scripts are saved in the session's `workflows/scripts` folder. In the same session they resume with
  `resumeFromRunId`; otherwise re-run them — the agents will find the existing files.
- Agents may have left Vite dev servers on ports 5181-5216; they are safe to kill.

Next steps, in order
1. Finish and verify the engine modules (`elo`, `adaptive`, `daily` must exist) and `src/server/llm`;
   `bun test tests/unit` and `bunx tsc --noEmit` green.
2. Boot locally (`bun run build`, `bun start`), walk landing -> scan -> map, push to `main`, verify prod.
3. `bun run import-data` once `data/short-task-names.json` exists; pool: `railway run bun scripts/generate-pool.ts`.
4. Not written yet: `POST /api/reports` + `/r/:id`, `POST /api/demo` + demo seeding, `GET /api/calendar.ics`,
   `/metrics`, wiring `seoPages` + sitemap + robots into `app.ts`, CI, README, e2e, deck, pitch docs.
5. Sync the footer attribution (web `ui/index.tsx`, `ssr/layout.ts`) with the exact O*NET wording in `data/ATTRIBUTION.md`.

Stopped at: 2026-11-14 20:52 local time (Astana).

File inventory at stop:
```
ls: cannot access 'src/server/llm': No such file or directory
ls: cannot access 'src/web/drill': No such file or directory
ls: cannot access 'src/web/funnel': No such file or directory
ls: cannot access 'src/web/dashboard': No such file or directory
data:
alt-titles.json
modern-titles.json
occupations.json
pool
raw
short-task-names.json

scripts:
import-data.ts
lib

src/engine:
adaptive.ts
daily.ts
drillSchema.ts
elo.ts
exposure.ts
occupations.ts
safeMath.ts
scoring.ts
search.ts
share.ts
verifyDrill.ts
whyHeuristic.ts

src/server/ssr:
html.ts
layout.ts

src/web/pages:
About.tsx
Checkout.tsx
Dashboard.tsx
Drill.tsx
ExposureMap.tsx
Landing.tsx
Paywall.tsx
Result.tsx
Scan.tsx
StartDrill.tsx
Survey.tsx
landing

tests/unit:
adaptive.test.ts
daily.test.ts
elo.test.ts
exposure.test.ts
safeMath.test.ts
scoring.test.ts
share.test.ts
verifyDrill.test.ts
whyHeuristic.test.ts
```

Unit tests at stop:
```
bun test v1.4.4 (38afee6c8)

 280 pass
 0 fail
 6519 expect() calls
Ran 280 tests across 9 files. [256.00ms]
```
