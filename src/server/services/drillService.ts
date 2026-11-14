import { FIRST_LEVEL, nextLevel, weakSpot, type TypeOutcome } from "../../engine/adaptive";
import { currentStreak, dailyNumber, etDay, nextEtMidnight, pickDailyIndex } from "../../engine/daily";
import { EXTRA_FLAGS, listTargets, toPublicDrill, type Drill, type ErrorType, type Level } from "../../engine/drillSchema";
import { updateRating } from "../../engine/elo";
import { FREQUENCY_WEIGHT } from "../../engine/exposure";
import type { Occupation, OccupationTask } from "../../engine/occupations";
import { normalizeFlags, scoreAttempt, type Flag, type WhyScore } from "../../engine/scoring";
import { shareGrid, shareText } from "../../engine/share";
import type {
  AttemptResult,
  DailyStatus,
  DrillMode,
  DrillResponse,
  GenerationStage,
  ReadyEvent,
} from "../../shared/api";
import { PRACTICE_DAILY_LIMIT } from "../../shared/pricing";
import type { Env } from "../env";
import { generateDrill, gradeWhy, type LlmLogger, type StructuredProvider } from "../llm";
import type { OccupationStore } from "../occupationStore";
import type { AttemptRepo } from "../repos/attempts";
import type { DrillRepo, StoredDrill } from "../repos/drills";
import type { EventRepo } from "../repos/events";
import { isPro, type Session, type SessionRepo } from "../repos/sessions";
import { buildAnnotations, collectCues } from "./attemptResult";
import { rankPoolDrills, type DrillPool } from "./pool";

/** A failure the HTTP layer turns into a status code and an error code. */
export class ServiceError extends Error {
  constructor(
    readonly status: 402 | 403 | 404 | 409 | 429 | 500,
    readonly code: string,
  ) {
    super(code);
  }
}

export type StageListener = (stage: GenerationStage) => void;

export interface Providers {
  claude?: StructuredProvider;
  claudeFast?: StructuredProvider;
  gemini?: StructuredProvider;
}

export interface DrillServiceDeps {
  env: Pick<Env, "APP_URL" | "GEN_LIMIT_PER_SESSION" | "GEN_LIMIT_GLOBAL">;
  now: () => Date;
  occupations: OccupationStore;
  sessions: SessionRepo;
  drills: DrillRepo;
  attempts: AttemptRepo;
  events: EventRepo;
  pool: DrillPool;
  providers: Providers;
  llmLog: LlmLogger;
}

/**
 * How long a person waits for a live drill before we hand them one from the
 * verified pool. Generation keeps running in the background; if it succeeds the
 * drill is theirs next time.
 */
export const USER_WAIT_BUDGET_MS = 45_000;

/**
 * After a live generation fails, the pool is served straight away for this long
 * instead of making the next person wait for the same outage. Short enough that
 * live drills come back by themselves once the provider does.
 */
export const LIVE_COOLDOWN_MS = 3 * 60_000;

/** Used when an occupation has no AI-exposed (E1/E2) task to build a drill on. */
const GENERIC_TASK = {
  id: 0,
  text: "Handle the everyday written work of this role: messages, summaries, schedules and requests.",
} as const;

interface PendingGeneration {
  soc: string;
  stage: GenerationStage;
  listeners: Set<StageListener>;
  promise: Promise<StoredDrill | null>;
}

interface GenerationPlan {
  occupation: Occupation;
  task: { id: number; text: string };
  level: Level;
  requiredTypes: ErrorType[];
  avoidTitles: string[];
  /** Owner of the drill; null for a shared Daily Catch. */
  sessionId: string | null;
  /** Our own traffic (tests, the team): never spend model budget on it. */
  internal: boolean;
}

export class DrillService {
  /** In-flight generations, keyed by who they are for. One process, one replica — a Map is enough. */
  private readonly pending = new Map<string, PendingGeneration>();
  /** Epoch ms until which live generation is skipped (see LIVE_COOLDOWN_MS). */
  private liveDownUntil = 0;

  constructor(private readonly deps: DrillServiceDeps) {}

  // ───────────────────────────── Getting a drill ─────────────────────────────

  /**
   * Start generating the first personal drill as soon as the tasks are known, so it
   * is usually ready before the person finishes the scan. Safe to call repeatedly.
   */
  prepareFirstDrill(sessionId: string): void {
    const session = this.deps.sessions.find(sessionId);
    if (!session || session.attemptsCount > 0) return;
    const occupation = this.occupationOf(session);
    if (!occupation) return;

    const key = personalKey(sessionId);
    if (this.pending.get(key)?.soc === occupation.soc) return;
    if (this.deps.drills.unattemptedFor(sessionId).some((d) => d.drill.soc === occupation.soc)) return;
    this.startGeneration(key, this.personalPlan(session, occupation));
  }

  /** Resolve the drill a session should play next. Reports progress through `onStage`. */
  async next(session: Session, requested: "first" | "practice" | "daily", onStage: StageListener): Promise<ReadyEvent> {
    const occupation = this.occupationOf(session);
    if (!occupation) throw new ServiceError(409, "scan_required");
    if (requested === "daily") return this.nextDaily(occupation, session.isInternal, onStage);

    const mode = this.hasPersonalAttempt(session.id) ? "practice" : requested;
    if (mode === "practice") this.assertCanPractice(session);

    // A personal drill that was generated but never played always comes first.
    const waiting = this.deps.drills.unattemptedFor(session.id).find((d) => d.drill.soc === occupation.soc);
    if (waiting) return { drillId: waiting.drill.id, origin: waiting.origin };

    const key = personalKey(session.id);
    let generation = this.pending.get(key);
    if (!generation || generation.soc !== occupation.soc) {
      generation = this.startGeneration(key, this.personalPlan(session, occupation));
    }
    const stored = await this.waitFor(generation, onStage);
    if (stored) return { drillId: stored.drill.id, origin: stored.origin };

    onStage("pool");
    const fallback = this.pickFromPool(session, occupation);
    if (!fallback) throw new ServiceError(500, "no_drill_available");
    return { drillId: fallback.id, origin: "pool" };
  }

  /** The drill as the player may see it — never the key. */
  getDrill(session: Session, drillId: string): DrillResponse {
    const stored = this.requireAccessibleDrill(session, drillId);
    const attempt = this.deps.attempts.findForDrill(session.id, drillId);
    const mode = attempt?.mode ?? this.modeFor(session, stored.drill);
    if (!attempt && mode === "practice") this.assertCanPractice(session);
    const day = etDay(this.deps.now());
    return {
      drill: toPublicDrill(stored.drill),
      mode,
      origin: stored.origin,
      ...(mode === "daily" ? { dailyNumber: dailyNumber(attempt?.day ?? day) } : {}),
      ...(attempt ? { attemptId: attempt.attemptId } : {}),
    };
  }

  // ───────────────────────────── Daily Catch ─────────────────────────────

  dailyStatus(session: Session): DailyStatus {
    const now = this.deps.now();
    const day = etDay(now);
    const base = { number: dailyNumber(day), day, nextAt: nextEtMidnight(now).toISOString() };
    const occupation = this.occupationOf(session);
    if (!occupation) return { ...base, state: "needs_scan" };

    const drillId = this.deps.drills.dailyDrillId(day, occupation.soc) ?? this.assignDailyFromPool(day, occupation.soc);
    if (!drillId) return { ...base, state: "available" };

    const attempt = this.deps.attempts.findForDrill(session.id, drillId);
    if (!attempt) return { ...base, state: "available", drillId };
    return {
      ...base,
      state: "done",
      drillId,
      attemptId: attempt.attemptId,
      result: { caught: attempt.caught, total: attempt.total, delta: attempt.rating.delta },
    };
  }

  private async nextDaily(occupation: Occupation, internal: boolean, onStage: StageListener): Promise<ReadyEvent> {
    const day = etDay(this.deps.now());
    const { drills } = this.deps;
    const assigned = drills.dailyDrillId(day, occupation.soc) ?? this.assignDailyFromPool(day, occupation.soc);
    if (assigned) return { drillId: assigned, origin: drills.find(assigned)?.origin ?? "pool" };

    // No pool for this occupation: today's shared drill is generated once, by whoever arrives first.
    const key = `daily:${day}:${occupation.soc}`;
    const generation = this.pending.get(key) ?? this.startGeneration(key, this.dailyPlan(occupation, day, internal), day);
    const stored = await this.waitFor(generation, onStage);
    if (stored) return { drillId: drills.assignDaily(day, occupation.soc, stored.drill.id), origin: "live" };

    onStage("pool");
    const nearest = this.deps.pool.nearestSoc(occupation, (soc) => this.deps.occupations.get(soc)?.beta);
    const candidates = nearest ? this.deps.pool.for(nearest) : [];
    if (candidates.length === 0) throw new ServiceError(500, "no_drill_available");
    const fallback = candidates[pickDailyIndex(day, candidates.length)]!;
    return { drillId: drills.assignDaily(day, occupation.soc, fallback.id), origin: "pool" };
  }

  /** Launch occupations rotate through their pre-built pool: the same drill for everyone, every day. */
  private assignDailyFromPool(day: string, soc: string): string | null {
    const pool = this.deps.pool.for(soc);
    if (pool.length === 0) return null;
    return this.deps.drills.assignDaily(day, soc, pool[pickDailyIndex(day, pool.length)]!.id);
  }

  // ───────────────────────────── Submitting ─────────────────────────────

  /**
   * Score a submission. Hits are decided by code against the answer key; a model is
   * only asked to grade the optional one-line "why" notes, and a keyword heuristic
   * takes over if it is slow or unavailable.
   */
  async submit(session: Session, drillId: string, rawFlags: ReadonlyArray<Flag>, elapsedMs?: number): Promise<AttemptResult> {
    const { attempts, sessions, events } = this.deps;
    const stored = this.requireAccessibleDrill(session, drillId);
    const existing = attempts.findForDrill(session.id, drillId);
    if (existing) return existing;

    const { drill } = stored;
    const mode = this.modeFor(session, drill);
    if (mode === "practice") this.assertCanPractice(session);

    const targets = new Set(listTargets(drill.artifact).map((t) => t.id));
    const flags = normalizeFlags(
      rawFlags.filter((flag) => targets.has(flag.targetId)),
      drill.key.length + EXTRA_FLAGS,
    );
    const { whyScores, gradedBy } = await this.gradeNotes(drill, flags);
    const score = scoreAttempt(drill, flags, whyScores);

    // Re-read the session: the rating may have moved while the notes were being graded.
    const fresh = sessions.find(session.id) ?? session;
    const now = this.deps.now();
    const day = etDay(now);
    const ratingAfter = updateRating(fresh.rating, drill.level, score.p, fresh.attemptsCount);
    const delta = ratingAfter - fresh.rating;
    const isDaily = mode === "daily";
    const playedDays = [...attempts.list(session.id).map((a) => a.day), day];

    const result: AttemptResult = {
      attemptId: crypto.randomUUID(),
      drillId,
      mode,
      day,
      ...(isDaily ? { dailyNumber: dailyNumber(day) } : {}),
      drill: toPublicDrill(drill),
      annotations: buildAnnotations(drill, flags, score),
      caught: score.hits.length,
      total: drill.key.length,
      falseFlags: score.falseFlags.length,
      decoyFlags: score.decoyFlags.length,
      points: score.points,
      maxPoints: score.maxPoints,
      p: score.p,
      rating: { before: fresh.rating, after: ratingAfter, delta },
      streak: currentStreak(playedDays, day),
      cues: collectCues(drill, score),
      share: {
        grid: shareGrid(score),
        text: shareText({
          ...(isDaily ? { dailyNumber: dailyNumber(day) } : {}),
          occupationShort: this.deps.occupations.shortName(drill.soc),
          result: score,
          rating: ratingAfter,
          delta,
          url: this.deps.env.APP_URL,
        }),
      },
      isFirstAttempt: fresh.attemptsCount === 0,
      whyGradedBy: gradedBy,
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
      createdAt: now.toISOString(),
    };

    attempts.insert(session.id, result, flags);
    sessions.recordAttempt(session.id, ratingAfter);
    events.log(session.id, "drill_submit", now, {
      mode,
      level: drill.level,
      origin: stored.origin,
      caught: result.caught,
      total: result.total,
      falseFlags: result.falseFlags + result.decoyFlags,
    });
    return result;
  }

  getResult(session: Session, attemptId: string): AttemptResult {
    const found = this.deps.attempts.find(attemptId);
    if (!found || found.sessionId !== session.id) throw new ServiceError(404, "unknown_attempt");
    return found.result;
  }

  private async gradeNotes(
    drill: Drill,
    flags: ReadonlyArray<Flag>,
  ): Promise<{ whyScores: Record<string, WhyScore>; gradedBy: AttemptResult["whyGradedBy"] }> {
    const keyByTarget = new Map(drill.key.map((item) => [item.targetId, item]));
    const items = flags.flatMap((flag) => {
      const item = keyByTarget.get(flag.targetId);
      const why = flag.why?.trim();
      return item && why
        ? [{ targetId: flag.targetId, why, explanation: item.explanation, correction: item.correction, cue: item.cue }]
        : [];
    });
    if (items.length === 0) return { whyScores: {}, gradedBy: "none" };

    const provider = this.deps.providers.claudeFast ?? this.deps.providers.claude;
    let usedModel = false;
    const whyScores = await gradeWhy(items, {
      ...(provider ? { provider } : {}),
      log: (record) => {
        if (record.ok) usedModel = true;
        this.deps.llmLog(record);
      },
    });
    return { whyScores, gradedBy: usedModel ? "llm" : "heuristic" };
  }

  // ───────────────────────────── Generation ─────────────────────────────

  private startGeneration(key: string, plan: GenerationPlan, dailyDay?: string): PendingGeneration {
    const generation: PendingGeneration = {
      soc: plan.occupation.soc,
      stage: "queued",
      listeners: new Set(),
      promise: Promise.resolve(null),
    };
    const emit: StageListener = (stage) => {
      generation.stage = stage;
      for (const listener of generation.listeners) listener(stage);
    };
    generation.promise = this.generate(plan, emit)
      .then((stored) => {
        // A shared daily is assigned as soon as it exists, even if nobody is still waiting for it.
        if (stored && dailyDay) this.deps.drills.assignDaily(dailyDay, plan.occupation.soc, stored.drill.id);
        return stored;
      })
      .catch((error: unknown) => {
        console.error("drill generation failed:", error instanceof Error ? error.message : error);
        return null;
      })
      .finally(() => {
        if (this.pending.get(key) === generation) this.pending.delete(key);
      });
    this.pending.set(key, generation);
    return generation;
  }

  /** Claude → retry with verifier feedback → Gemini; null means "serve the pool". */
  private async generate(plan: GenerationPlan, emit: StageListener): Promise<StoredDrill | null> {
    const { providers, drills, llmLog } = this.deps;
    if (!providers.claude && !providers.gemini) return null;
    if (plan.internal || this.deps.now().getTime() < this.liveDownUntil) return null;
    if (!this.withinLimits(plan.sessionId)) return null;

    const generated = await generateDrill(
      {
        soc: plan.occupation.soc,
        occupation: plan.occupation.title,
        taskId: plan.task.id,
        task: plan.task.text,
        level: plan.level,
        requiredTypes: plan.requiredTypes,
        avoidTitles: plan.avoidTitles,
      },
      {
        ...(providers.claude ? { primary: providers.claude } : {}),
        ...(providers.gemini ? { secondary: providers.gemini } : {}),
        log: llmLog,
        newId: () => `d-${crypto.randomUUID().slice(0, 13)}`,
        onStage: emit,
      },
    );
    if (!generated) {
      this.liveDownUntil = this.deps.now().getTime() + LIVE_COOLDOWN_MS;
      return null;
    }

    const stored: StoredDrill = {
      drill: generated.drill,
      origin: "live",
      provider: generated.provider,
      model: generated.model,
      sessionId: plan.sessionId,
      createdAt: this.deps.now().toISOString(),
    };
    drills.upsert(stored);
    return stored;
  }

  private async waitFor(generation: PendingGeneration, onStage: StageListener): Promise<StoredDrill | null> {
    onStage(generation.stage);
    generation.listeners.add(onStage);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), USER_WAIT_BUDGET_MS);
    });
    try {
      return await Promise.race([generation.promise, timeout]);
    } finally {
      clearTimeout(timer);
      generation.listeners.delete(onStage);
    }
  }

  /** Cost guard: per-session and global caps on live generations per ET day. */
  private withinLimits(sessionId: string | null): boolean {
    const { env, drills } = this.deps;
    const dayStart = new Date(nextEtMidnight(this.deps.now()).getTime() - 24 * 60 * 60 * 1000).toISOString();
    if (drills.countLiveSince(dayStart) >= env.GEN_LIMIT_GLOBAL) return false;
    return sessionId === null || drills.countLiveSince(dayStart, sessionId) < env.GEN_LIMIT_PER_SESSION;
  }

  private personalPlan(session: Session, occupation: Occupation): GenerationPlan {
    const history = this.deps.attempts.list(session.id);
    const isFirst = history.length === 0;
    const weak = weakSpot(history.map(typeOutcomes));
    return {
      occupation,
      task: this.pickTask(session, occupation, history),
      level: isFirst ? FIRST_LEVEL : nextLevel(session.rating, session.attemptsCount),
      // The first drill always carries a numbers mistake: it is provable, so the first "aha" is indisputable.
      requiredTypes: weak ? [weak] : isFirst ? ["numbers"] : [],
      avoidTitles: history.slice(-5).map((a) => a.drill.artifact.title),
      sessionId: session.id,
      internal: session.isInternal,
    };
  }

  private dailyPlan(occupation: Occupation, day: string, internal: boolean): GenerationPlan {
    const exposed = exposedTasks(occupation);
    const number = dailyNumber(day);
    const task = exposed.length > 0 ? exposed[pickDailyIndex(day, exposed.length)]! : GENERIC_TASK;
    return {
      occupation,
      task: { id: task.id, text: task.text },
      level: number % 2 === 0 ? 3 : 2,
      requiredTypes: [],
      avoidTitles: [],
      sessionId: null,
      internal,
    };
  }

  /**
   * Drills train AI-exposed tasks only (E1/E2): prefer the person's own, most
   * frequent ones, and avoid repeating the tasks of their latest drills.
   */
  private pickTask(session: Session, occupation: Occupation, history: ReadonlyArray<AttemptResult>): { id: number; text: string } {
    const byId = new Map(occupation.tasks.map((t) => [t.id, t]));
    const own = this.deps.sessions
      .tasks(session.id)
      .flatMap((selected) => {
        const task = byId.get(selected.taskId);
        return task && task.label !== "E0" ? [{ task, weight: FREQUENCY_WEIGHT[selected.frequency] }] : [];
      })
      .sort((a, b) => b.weight - a.weight || Number(b.task.label === "E1") - Number(a.task.label === "E1"))
      .map((entry) => entry.task);

    const candidates = own.length > 0 ? own : exposedTasks(occupation);
    if (candidates.length === 0) return GENERIC_TASK;
    // Look back at most four drills, and never so far that every candidate is excluded.
    const lookBack = Math.min(candidates.length - 1, 4);
    const recent = new Set(lookBack > 0 ? history.slice(-lookBack).map((a) => a.drill.taskId) : []);
    const task = candidates.find((t) => !recent.has(t.id)) ?? candidates[0]!;
    return { id: task.id, text: task.text };
  }

  /** The closest verified pool drill this session has not played (and that is not today's Daily Catch). */
  private pickFromPool(session: Session, occupation: Occupation): Drill | null {
    const { pool, occupations, attempts, drills } = this.deps;
    const soc = pool.nearestSoc(occupation, (s) => occupations.get(s)?.beta);
    if (!soc) return null;
    const played = new Set(attempts.list(session.id).map((a) => a.drillId));
    const today = drills.dailyDrillId(etDay(this.deps.now()), occupation.soc);
    const ownTasks = new Set(this.deps.sessions.tasks(session.id).map((t) => t.taskId));
    const level = session.attemptsCount === 0 ? FIRST_LEVEL : nextLevel(session.rating, session.attemptsCount);
    const ranked = rankPoolDrills(pool.for(soc), { taskIds: ownTasks, level });
    return ranked.find((d) => !played.has(d.id) && d.id !== today) ?? ranked.find((d) => !played.has(d.id)) ?? null;
  }

  // ───────────────────────────── Rules ─────────────────────────────

  private occupationOf(session: Session): Occupation | undefined {
    return session.soc ? this.deps.occupations.get(session.soc) : undefined;
  }

  private hasPersonalAttempt(sessionId: string): boolean {
    return this.deps.attempts.list(sessionId).some((a) => a.mode !== "daily");
  }

  /** Today's Daily Catch is free; the first personal drill is free; everything after that is Practice (Pro). */
  private modeFor(session: Session, drill: Drill): DrillMode {
    const day = etDay(this.deps.now());
    if (session.soc && this.deps.drills.dailyDrillId(day, session.soc) === drill.id) return "daily";
    return this.hasPersonalAttempt(session.id) ? "practice" : "first";
  }

  private assertCanPractice(session: Session): void {
    const now = this.deps.now();
    if (!isPro(session, now)) throw new ServiceError(402, "pro_required");
    if (this.deps.attempts.countOnDay(session.id, etDay(now), "practice") >= PRACTICE_DAILY_LIMIT) {
      throw new ServiceError(429, "practice_limit");
    }
  }

  private requireAccessibleDrill(session: Session, drillId: string): StoredDrill {
    const stored = this.deps.drills.find(drillId);
    // Personal drills are visible to their owner only; pool and shared daily drills to everyone.
    if (!stored || (stored.sessionId !== null && stored.sessionId !== session.id)) {
      throw new ServiceError(404, "unknown_drill");
    }
    return stored;
  }
}

function personalKey(sessionId: string): string {
  return `personal:${sessionId}`;
}

/** AI-exposed tasks of an occupation, most central first (Core before Supplemental, E1 before E2). */
function exposedTasks(occupation: Occupation): OccupationTask[] {
  return occupation.tasks
    .filter((t) => t.label !== "E0")
    .sort(
      (a, b) =>
        Number(b.type === "Core") - Number(a.type === "Core") || Number(b.label === "E1") - Number(a.label === "E1"),
    );
}

/** Which planted mistakes of a past attempt were found — the input for weak-spot detection. */
export function typeOutcomes(attempt: AttemptResult): TypeOutcome[] {
  return attempt.annotations.flatMap((a) =>
    a.keyType ? [{ type: a.keyType, caught: a.kind === "caught" || a.kind === "wrong_type" }] : [],
  );
}
