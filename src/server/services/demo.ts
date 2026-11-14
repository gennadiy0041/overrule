import { addDays, dailyNumber, daysBetween, etDay, pickDailyIndex } from "../../engine/daily";
import { ERROR_TYPES, listTargets, type Drill, type ErrorType } from "../../engine/drillSchema";
import { START_RATING } from "../../engine/elo";
import type { Occupation } from "../../engine/occupations";
import type { Flag } from "../../engine/scoring";
import type { ScanAnswers } from "../../shared/api";
import { TRIAL_DAYS } from "../../shared/pricing";
import type { AppContext } from "../context";
import type { Session, UserTask } from "../repos/sessions";
import { DrillService } from "./drillService";

/**
 * The demo profile ("Jess · Marketing Manager") is not hand-written data: a
 * scripted player plays a week of real pool drills through the real engine —
 * the same `submit`, scoring and Elo as any user. Every visitor of /demo gets
 * their own copy and can play today's Daily Catch as Jess.
 */
export const DEMO_SOC = "11-2021.00";
export const DEMO_TEMPLATE_ID = "demo-template";

const DEMO_DAYS = 7;
/** Today's and the next two Daily Catch drills stay unplayed so the visitor (and tomorrow's visitor) can play them. */
const RESERVED_DAYS = 3;
/** Days ago on which Jess also did a personal drill. */
const PERSONAL_DRILL_DAYS: ReadonlySet<number> = new Set([7, 5, 4, 2]);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Seed of the scripted player. Fixed, so the simulated week is the same on every
 * boot; picked among a few dozen seeds for a week that shows the intended arc
 * clearly (catch rate from roughly 45% to 85%, false alarms fading out).
 */
export const DEMO_SEED = 47;

const JESS_ANSWERS: ScanAnswers = { aiUse: "daily", aiInReview: "yes", shippedAiError: "yes", worry: "careless" };
const JESS_TASK_COUNT = 10;

/** Small deterministic PRNG: the simulated week is identical on every boot. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An instant around midday in New York on the given ET day (17:30 UTC is 12:30 EST / 13:30 EDT). */
function middayOf(day: string): Date {
  return new Date(`${day}T17:30:00Z`);
}

interface PlayerSkill {
  catchRate: number;
  typeAccuracy: number;
  falseFlagRate: number;
  decoyFlagRate: number;
}

/** Jess improves over the week: she catches more, names the type more often, and stops over-flagging. */
function skillOn(dayIndex: number): PlayerSkill {
  const progress = dayIndex / (DEMO_DAYS - 1);
  return {
    catchRate: 0.45 + 0.45 * progress,
    typeAccuracy: 0.7 + 0.25 * progress,
    falseFlagRate: 0.7 - 0.65 * progress,
    decoyFlagRate: 0.6 - 0.55 * progress,
  };
}

/** Her blind spot, so the dashboard has a real weak spot to show. */
const WEAK_TYPE: ErrorType = "risk";
const WEAK_TYPE_PENALTY = 0.3;
const NOTE_RATE = 0.6;

function scriptedFlags(drill: Drill, skill: PlayerSkill, random: () => number): Flag[] {
  const flags: Flag[] = [];
  for (const item of drill.key) {
    const chance = skill.catchRate - (item.type === WEAK_TYPE ? WEAK_TYPE_PENALTY : 0);
    if (random() >= chance) continue;
    const type =
      random() < skill.typeAccuracy
        ? item.type
        : ERROR_TYPES[(ERROR_TYPES.indexOf(item.type) + 1) % ERROR_TYPES.length]!;
    flags.push({ targetId: item.targetId, type, ...(random() < NOTE_RATE ? { why: item.cue.slice(0, 140) } : {}) });
  }
  for (const decoy of drill.decoys) {
    if (random() < skill.decoyFlagRate) flags.push({ targetId: decoy.targetId, type: "numbers" });
  }
  if (random() < skill.falseFlagRate) {
    const special = new Set([...drill.key, ...drill.decoys].map((entry) => entry.targetId));
    const plain = listTargets(drill.artifact).filter((target) => !special.has(target.id));
    const pick = plain[Math.floor(random() * plain.length)];
    if (pick) flags.push({ targetId: pick.id, type: "facts" });
  }
  return flags;
}

function jessTasks(occupation: Occupation): UserTask[] {
  const core = occupation.tasks.filter((task) => task.type === "Core").slice(0, JESS_TASK_COUNT);
  return core.map((task, index) => ({
    taskId: task.id,
    frequency: index < 4 ? "often" : index < 8 ? "sometimes" : "rarely",
  }));
}

/**
 * (Re)build the template week. Runs at boot; a no-op until the Marketing pool exists.
 * Returns the number of attempts played.
 */
export async function seedDemoTemplate(ctx: AppContext, seed = DEMO_SEED): Promise<number> {
  const occupation = ctx.occupations.get(DEMO_SOC);
  const pool = ctx.pool.for(DEMO_SOC);
  ctx.sessions.remove(DEMO_TEMPLATE_ID);
  if (!occupation || pool.length === 0) return 0;

  const today = etDay(ctx.now());
  let clock = middayOf(addDays(today, -DEMO_DAYS));
  // Same engine, but a private clock and no model: notes are graded by the keyword heuristic.
  const service = new DrillService({
    env: ctx.env,
    now: () => clock,
    occupations: ctx.occupations,
    sessions: ctx.sessions,
    drills: ctx.drills,
    attempts: ctx.attempts,
    events: ctx.events,
    pool: ctx.pool,
    providers: {},
    llmLog: () => undefined,
  });

  ctx.sessions.create({ id: DEMO_TEMPLATE_ID, now: clock, userAgent: null, isInternal: true, isDemo: true });
  ctx.sessions.saveScan(DEMO_TEMPLATE_ID, DEMO_SOC, jessTasks(occupation), JESS_ANSWERS);
  ctx.sessions.startTrial(DEMO_TEMPLATE_ID, "annual", new Date(middayOf(today).getTime() + TRIAL_DAYS * DAY_MS));
  const jess = (): Session => ctx.sessions.find(DEMO_TEMPLATE_ID)!;

  const rotation = (day: string) => pool[pickDailyIndex(day, pool.length)]!.id;
  const reserved = new Set(Array.from({ length: RESERVED_DAYS }, (_, i) => rotation(addDays(today, i))));
  const pastDailies = new Set(
    Array.from({ length: DEMO_DAYS }, (_, i) => {
      const day = addDays(today, -(i + 1));
      return ctx.drills.dailyDrillId(day, DEMO_SOC) ?? rotation(day);
    }),
  );
  const personal = pool.filter((drill) => !reserved.has(drill.id) && !pastDailies.has(drill.id));

  const random = mulberry32(seed);
  const play = async (drillId: string, skill: PlayerSkill): Promise<void> => {
    const stored = ctx.drills.find(drillId);
    if (!stored || ctx.attempts.findForDrill(DEMO_TEMPLATE_ID, drillId)) return;
    const elapsedMs = Math.round((170 + random() * 130) * 1000);
    await service.submit(jess(), drillId, scriptedFlags(stored.drill, skill, random), elapsedMs);
  };

  for (let daysAgo = DEMO_DAYS; daysAgo >= 1; daysAgo--) {
    const skill = skillOn(DEMO_DAYS - daysAgo);
    clock = middayOf(addDays(today, -daysAgo));
    const daily = service.dailyStatus(jess()).drillId;
    if (daily && !reserved.has(daily)) await play(daily, skill);

    if (PERSONAL_DRILL_DAYS.has(daysAgo)) {
      const drill = personal.shift();
      clock = new Date(clock.getTime() + 3 * HOUR_MS);
      if (drill) await play(drill.id, skill);
    }
  }
  return ctx.attempts.list(DEMO_TEMPLATE_ID).length;
}

/** A fresh copy of the template week for one visitor, shifted so that its last day is yesterday. */
export function createDemoSession(ctx: AppContext, visitor: { userAgent: string | null; isInternal: boolean }): Session {
  const now = ctx.now();
  const today = etDay(now);
  const occupation = ctx.occupations.get(DEMO_SOC);
  const session = ctx.sessions.create({ id: crypto.randomUUID(), now, isDemo: true, ...visitor });

  const templateTasks = ctx.sessions.tasks(DEMO_TEMPLATE_ID);
  const tasks = templateTasks.length > 0 ? templateTasks : occupation ? jessTasks(occupation) : [];
  if (tasks.length > 0) ctx.sessions.saveScan(session.id, DEMO_SOC, tasks, JESS_ANSWERS);
  ctx.sessions.startTrial(session.id, "annual", new Date(now.getTime() + TRIAL_DAYS * DAY_MS));

  const week = ctx.attempts.listRaw(DEMO_TEMPLATE_ID);
  const last = week[week.length - 1];
  if (!last) return ctx.sessions.find(session.id)!;

  const shift = daysBetween(last.result.day, addDays(today, -1));
  const todaysDaily = ctx.drillService.dailyStatus(ctx.sessions.find(session.id)!).drillId;
  let rating = START_RATING;
  let count = 0;
  for (const { result, flags } of week) {
    // Never hand the visitor a profile that has already played today's Daily Catch.
    if (result.drillId === todaysDaily) continue;
    const day = addDays(result.day, shift);
    ctx.attempts.insert(
      session.id,
      {
        ...result,
        attemptId: crypto.randomUUID(),
        day,
        createdAt: new Date(new Date(result.createdAt).getTime() + shift * DAY_MS).toISOString(),
        ...(result.mode === "daily" ? { dailyNumber: dailyNumber(day) } : {}),
      },
      flags,
    );
    rating = result.rating.after;
    count++;
  }
  ctx.sessions.setProgress(session.id, rating, count);
  return ctx.sessions.find(session.id)!;
}
