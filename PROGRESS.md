# PROGRESS — Overrule (Business Cup 2.0)

Working memory for the build. Updated after every milestone.

- Prod: https://overrule-production.up.railway.app
- Repo: https://github.com/gennadiy0041/overrule
- Deck: `deck/Overrule_BusinessCup2.pdf` (10 slides, the submission) · stage version: `deck/pitch.html` (plays the film)
- Film (30 s): https://overrule-production.up.railway.app/film · walkthrough video: `docs/demo.mp4`
- Railway: project `business-cup-demo`, service `overrule` (`ab5e6d03-de53-4911-9d1c-5cdc9cdbcc0a`), volume `/data`
- Deadline: final package by 2026-11-15 11:00 Astana (form closes 12:00)

## State on 2026-11-15, 11:40 Astana

Everything in P0 and P1 is live in production and covered by tests: 384 unit/API tests, 12 Playwright e2e runs
against production (phone + desktop). Model credit is back: live generation is on, under a dollar ceiling
(about $0.54 of $18 spent in production).

### P0 — done

- [x] Data import (923 occupations, 19,265 tasks), `exposure` engine, test reproducing published β for all 923
- [x] Engine: safeMath, verifyDrill, scoring, why-heuristic, share, elo, adaptive, daily, search
- [x] LLM layer: Claude → retry with verifier findings → Gemini → verified pool; why-note grading; blind cross-check
- [x] Drill pool: 54 verified drills for all six launch occupations, all cross-checked (`data/pool/stats.json`)
- [x] Landing → scan → map → drill → submit → result → Elo → soft paywall → demo checkout → dashboard
- [x] Anonymous sessions, events, Railway deploy, public repo, README

### P1 — done

- [x] Daily Catch with share grid, streak, `.ics` reminder
- [x] Demo profile (replayed through the real engine), Weekly Debrief, Review Report (`/r/:id`)
- [x] 923 SEO pages + sitemap + robots, `/about`, `/metrics`, `/survey` and the micro-survey
- [x] Generation limits, a dollar ceiling on model spend, provider cooldown, internal traffic excluded from
      metrics and model spend
- [x] e2e against prod, CI, README, `docs/defense-ru.md`

### Pitch package — done

- [x] Deck PDF with production screenshots, pitch script (5 and 3 min), Q&A, demo video, LinkedIn post

### P2

- [x] Installable web app (manifest and icons; start URL is the Daily Catch). No service worker, so not offline.
- [x] Defend your work (`/defend`) — live since 11:32 on Nov 15. Paste a text you are about to send, get five
      questions about its own lines, answer, see which answers hold; first one free, then 5 for $4.99 (demo
      checkout). Built at the founder's request after outside feedback that the product lacked a reason to open
      it before a real task. It was acceptable to ship this late because it does not touch the drill path and
      every model step has a rule-based fallback; it is backed by 28 tests, e2e on phone and desktop and one live
      run with the model. It has had no outside users.
- [ ] Second Look — deliberately not built: it is an LLM feature, and model credit came back three hours before
      the deadline. An unverified feature shipped hours before judging is a worse bet than one flawless path.
      It is on the roadmap.
- [ ] Partner Catch (sponsored drills with a reward for the member) — a hypothesis in the deck, not built.
- [ ] Dynamic OG image of a result — not built.

### Known gaps

- The engine modules written by agents are covered by tests (control examples from the spec, real-data checks);
  the planned fresh-eyes review did not run. The scoring module was read through by the lead.
- Live drills are verified for structure and arithmetic only. In one of three live drills read on Nov 15 the
  document carried a detail that was not in the brief and not in the key (a testing date); flagging it counts as
  a false flag. The blind cross-check covers the pool, not live drills.
- Gemini, the second provider, answered 2 of 6 calls during the cross-check (quota). When Claude fails, the
  realistic fallback is the verified pool.

## Things to know

- **Model credit and the ceiling.** Credit is back and live generation is on. `LLM_BUDGET_USD=18` is set on
  Railway: the product estimates its own spend from the ledger of model calls and stops calling models at the
  ceiling (then: verified pool, heuristic grading). `/metrics` shows spend against the ceiling. An accepted
  level-2 drill costs about $0.05–0.06 at list prices; grading the notes of an attempt a fraction of a cent.
- **Verified live on Nov 15** with five scripted real-visitor runs on production (nurse, software developer,
  teacher, lawyer, marketing manager). Four got a live first drill 10–12 s after pressing start; the lawyer run hit
  a rejected draft, waited 46 s and got a pool drill, which is what the strict tool schema then removed. In every
  run the notes were graded by the model and the result came in 3 s; once it was prepared ahead, today's Daily
  Catch opened in 2 s. The sessions were then tagged internal.
- **For a demo use a fresh private window.** A browser tagged with `/?internal=1` gets pool drills only.
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
- Nov 15 07:30 Credit is back. Added a dollar ceiling on model spend (default 20, 18 in production: the owner's
  limit is $20 in total, and the morning checks run from this machine cost about $1.10).
- Nov 15 08:00 A live run found the shared Daily Catch generated on the click: 48 s, then another occupation's
  drill. It is now prepared when the scan is finished; verified live (2 s).
- Nov 15 08:10 Medium effort is faster per draft but fails the verifier far more often; default effort kept.
- Nov 15 08:15 The six hand-written Customer Service drills passed the blind cross-check (19 of 20 found).
- Nov 15 08:30 Two of sixteen drafts carried `brief` as a string and cost a retry (one visitor got a pool drill
  after 46 s). The Claude tool is now strict; 7 of 7 drafts passed on the first try afterwards.
- Nov 15 08:50 The deck was rebuilt around the founder's opening: slide 1 is the Kalyp logo, slide 2 the four
  positions and the US figure, slide 3 the 30-second film, slide 10 the proverb "Trust, but verify".
- Nov 15 08:50 The founder's figure of 219,000 layoffs since January could not be found in any source. Slide 2
  uses 121,401: US job cuts in January–October 2026 where the employer named AI as the reason (Challenger,
  Gray & Christmas, report of Nov 5, 2026; 617,189 announced in all; 54,836 AI-attributed in all of 2025).
- More in `docs/decisions.md`.
