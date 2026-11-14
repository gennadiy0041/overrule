# PROGRESS — Overrule (Business Cup 2.0)

Working memory for the build. Updated after every milestone.

- Prod: https://overrule-production.up.railway.app
- Repo: https://github.com/gennadiy0041/overrule
- Deck: `deck/Overrule_BusinessCup2.pdf` (10 slides) · Video: `docs/demo.mp4`
- Railway: project `business-cup-demo`, service `overrule` (`ab5e6d03-de53-4911-9d1c-5cdc9cdbcc0a`), volume `/data`
- Deadline: final package by 2026-11-15 11:00 Astana (form closes 12:00)

## State on 2026-11-15, 03:30 Astana

Everything in P0 and P1 is live in production and covered by tests: 321 unit/API tests, 10 Playwright e2e runs
against production (phone + desktop), CI green.

### P0 — done

- [x] Data import (923 occupations, 19,265 tasks), `exposure` engine, test reproducing published β for all 923
- [x] Engine: safeMath, verifyDrill, scoring, why-heuristic, share, elo, adaptive, daily, search
- [x] LLM layer: Claude → retry with verifier findings → Gemini → verified pool; why-note grading; blind cross-check
- [x] Drill pool: 54 verified drills for all six launch occupations (48 cross-checked; see `data/pool/stats.json`)
- [x] Landing → scan → map → drill → submit → result → Elo → soft paywall → demo checkout → dashboard
- [x] Anonymous sessions, events, Railway deploy, public repo, README

### P1 — done

- [x] Daily Catch with share grid, streak, `.ics` reminder
- [x] Demo profile (replayed through the real engine), Weekly Debrief, Review Report (`/r/:id`)
- [x] 923 SEO pages + sitemap + robots, `/about`, `/metrics`, `/survey` and the micro-survey
- [x] Generation limits, provider cooldown, internal traffic excluded from metrics and model spend
- [x] e2e against prod, CI, README, `docs/defense-ru.md`

### Pitch package — done

- [x] Deck PDF with production screenshots, pitch script (5 and 3 min), Q&A, demo video, LinkedIn post

### Not done

- [ ] P2: Second Look, dynamic OG image, PWA
- [ ] Engine modules were written by agents and are covered by tests, but the planned fresh-eyes review never ran

## Things to know

- **Model credit.** The Anthropic account ran out of credit during the pool run; Gemini is at its quota. Until credit
  is added, every drill comes from the verified pool (instant, labelled "pre-verified drill"). Live generation
  resumes by itself within three minutes of a top-up — no deploy needed. One live drill costs roughly $0.07–0.15.
- **Deploys are manual.** A push to `main` does not trigger Railway here. After pushing, re-attach the source:
  Railway MCP `connect-service-source` (repo `gennadiy0041/overrule`, branch `main`) — it builds the latest commit.
- **Live numbers in the deck.** `bun run build-deck` reads `/metrics` (token in `.local/metrics-token.txt`, also
  the `METRICS_TOKEN` variable on Railway). Rebuild after the survey post so slide 8 shows real numbers with N.
- **Refreshing visuals:** `bun run screenshots` → `bun run build-deck` → `bun run record-demo`.

## Decision log

- Nov 14 20:20 Repo lives in `overrule/` next to the prompt file; the prompt (with the selftest token) stays outside.
- Nov 14 20:25 Percentiles are ranked on β recomputed from task labels: the published CSV stores Pharmacists as
  0.39999999999999997, which shifts Project Management Specialists from 64.1% to 64.2%. A unit test documents it.
- Nov 15 02:20 Parallel agent workflows hit the usage limit twice; the rest was written sequentially by the lead.
- Nov 15 02:35 Claude rejects a forced `tool_choice` → optional tool call. Gemini rejects our schema → JSON mode.
- Nov 15 02:45 Credit ran out mid-pool → cooldown + pool-only mode; six Customer Service drills written in-session.
- Nov 15 02:50 Minified one-line effects returned a promise as cleanup and crashed navigation → block-bodied effects.
- More in `docs/decisions.md`.
