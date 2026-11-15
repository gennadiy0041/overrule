/**
 * The HTTP contract between the Bun server and the React app.
 * Request bodies are zod schemas (validated on the server); responses are plain types.
 */
import { z } from "zod";
import { ErrorTypeSchema, type ErrorType, type Level, type PublicDrill, type Severity } from "../engine/drillSchema";
import type { ExposureLabel, Frequency, TaskType } from "../engine/exposure";
import {
  ANSWER_MAX,
  QUESTION_MAX,
  QUOTE_MAX,
  REHEARSAL_QUESTIONS,
  REHEARSAL_TEXT_MAX,
  REHEARSAL_TEXT_MIN,
  type AnswerVerdict,
  type RehearsalQuestion,
} from "../engine/rehearsal";

// ───────────────────────────── Occupations ─────────────────────────────

export interface OccupationSummary {
  soc: string;
  title: string;
  slug: string;
  /** Occupation-level AI exposure, 0–1. */
  beta: number;
  /** Share (0–100) of the 923 occupations with a strictly lower β. */
  percentile: number;
  /** Has a pre-generated, cross-checked drill pool. */
  starter: boolean;
}

export interface OccupationHit extends OccupationSummary {
  /** The alternate or modern job title that matched, when it wasn't the official one. */
  matchedTitle?: string;
  /** Nothing matched literally; this is the closest occupation we could find. */
  closest: boolean;
}

export interface TaskView {
  id: number;
  text: string;
  short?: string;
  type: TaskType;
  label: ExposureLabel;
}

export interface OccupationDetail extends OccupationSummary {
  tasks: TaskView[];
}

// ───────────────────────────── Scan & map ─────────────────────────────

export const FREQUENCIES = ["often", "sometimes", "rarely"] as const;

export const SCAN_OPTIONS = {
  aiUse: ["never", "monthly", "weekly", "daily"],
  aiInReview: ["yes", "no", "not_sure"],
  shippedAiError: ["yes", "no", "not_sure"],
  worry: ["careless", "behind", "automation", "compliance"],
} as const;

export const ScanAnswersSchema = z
  .object({
    aiUse: z.enum(SCAN_OPTIONS.aiUse),
    aiInReview: z.enum(SCAN_OPTIONS.aiInReview),
    shippedAiError: z.enum(SCAN_OPTIONS.shippedAiError),
    worry: z.enum(SCAN_OPTIONS.worry),
  })
  .partial();
export type ScanAnswers = z.infer<typeof ScanAnswersSchema>;

export const SocSchema = z.string().regex(/^\d{2}-\d{4}\.\d{2}$/);

/**
 * Sent twice: once right after the tasks are picked (so the first drill can be
 * generated while the person answers the remaining questions), and once at the
 * end with `complete: true`.
 */
export const ScanRequestSchema = z.object({
  soc: SocSchema,
  tasks: z
    .array(z.object({ taskId: z.number().int(), frequency: z.enum(FREQUENCIES) }))
    .min(3)
    .max(60),
  answers: ScanAnswersSchema.optional(),
  complete: z.boolean().optional(),
});
export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export interface MapTask extends TaskView {
  frequency: Frequency;
}

export interface MapResponse {
  occupation: OccupationSummary;
  personal: {
    /** β over the tasks this person actually does, weighted by frequency. */
    beta: number;
    /** Share (0–100) of occupations whose β is strictly lower than the personal β. */
    percentile: number;
    /** Share of the person's weighted work per label. */
    shares: Record<ExposureLabel, number>;
    taskCount: number;
  };
  medianBeta: number;
  occupationCount: number;
  tasks: MapTask[];
  answers: ScanAnswers;
}

// ───────────────────────────── Drills ─────────────────────────────

export type DrillMode = "first" | "daily" | "practice";
export type DrillOrigin = "live" | "pool";

export const NextDrillRequestSchema = z.object({ mode: z.enum(["first", "practice", "daily"]) });
export type NextDrillRequest = z.infer<typeof NextDrillRequestSchema>;

/** `POST /api/drills/next` streams these as server-sent events named "stage". */
export type GenerationStage = "queued" | "drafting" | "verifying" | "retrying" | "switching_provider" | "pool";
export interface StageEvent {
  stage: GenerationStage;
}
/** …and finishes with one event named "ready" (or "failed"). */
export interface ReadyEvent {
  drillId: string;
  origin: DrillOrigin;
}

export interface DrillResponse {
  drill: PublicDrill;
  mode: DrillMode;
  origin: DrillOrigin;
  dailyNumber?: number;
  /** Set when this session has already submitted this drill. */
  attemptId?: string;
}

export const FlagSchema = z.object({
  targetId: z.string().min(1).max(16),
  type: ErrorTypeSchema,
  why: z.string().max(140).optional(),
});

export const SubmitRequestSchema = z.object({
  flags: z.array(FlagSchema).max(8),
  elapsedMs: z.number().int().nonnegative().max(3_600_000).optional(),
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;

export type AnnotationKind =
  | "caught" // flagged a planted mistake with the right type
  | "wrong_type" // flagged a planted mistake, picked another type
  | "missed" // planted mistake not flagged
  | "false_flag" // flagged a line that was fine
  | "decoy_flagged" // flagged a line that only looked wrong
  | "decoy_avoided"; // left a look-wrong line alone

export interface Annotation {
  targetId: string;
  kind: AnnotationKind;
  flaggedType?: ErrorType;
  keyType?: ErrorType;
  severity?: Severity;
  explanation?: string;
  correction?: string;
  cue?: string;
  looksWrongBecause?: string;
  fineBecause?: string;
  why?: string;
  whyScore?: 0 | 1 | 2;
  points?: number;
}

export interface AttemptResult {
  attemptId: string;
  drillId: string;
  mode: DrillMode;
  /** America/New_York calendar day of the attempt. */
  day: string;
  dailyNumber?: number;
  /** The document again, so the result page can annotate it in place. */
  drill: PublicDrill;
  annotations: Annotation[];
  caught: number;
  total: number;
  falseFlags: number;
  decoyFlags: number;
  points: number;
  maxPoints: number;
  p: number;
  rating: { before: number; after: number; delta: number };
  streak: number;
  /** "What to watch for" — the reusable habits behind the mistakes in this drill. */
  cues: string[];
  share: { text: string; grid: string };
  /** First scored attempt of this session: show the micro-survey, then the paywall. */
  isFirstAttempt: boolean;
  whyGradedBy: "llm" | "heuristic" | "none";
  elapsedMs?: number;
  createdAt: string;
}

// ───────────────────────────── Daily Catch & dashboard ─────────────────────────────

export interface DailyStatus {
  /** Daily Catch #N — #1 was 2026-11-14 (America/New_York). */
  number: number;
  day: string;
  /** Instant the next Daily Catch unlocks (next ET midnight), ISO 8601. */
  nextAt: string;
  state: "needs_scan" | "available" | "done";
  drillId?: string;
  attemptId?: string;
  result?: { caught: number; total: number; delta: number };
}

export interface HistoryEntry {
  attemptId: string;
  drillId: string;
  title: string;
  mode: DrillMode;
  level: Level;
  day: string;
  createdAt: string;
  caught: number;
  total: number;
  falseFlags: number;
  ratingAfter: number;
  delta: number;
}

export interface WeeklyDebrief {
  from: string;
  to: string;
  drills: number;
  caught: number;
  total: number;
  falseFlags: number;
  ratingChange: number;
  strongest: ErrorType | null;
  weakest: ErrorType | null;
  headline: string;
  lines: string[];
}

export type PercentileStatus =
  | { locked: true; players: number; needed: number }
  | { locked: false; value: number; scope: "occupation" | "all"; players: number };

export interface MeResponse {
  hasScan: boolean;
  occupation?: OccupationSummary & { short: string };
  plan: "free" | "trial";
  planChoice?: "annual" | "monthly";
  trialEndsAt?: string;
  isPro: boolean;
  isDemo: boolean;
  /** Judgment Score. */
  rating: number;
  attemptsCount: number;
  streak: number;
  /** Oldest → newest. */
  history: HistoryEntry[];
  byType: Record<ErrorType, { appeared: number; caught: number }>;
  /** Flags on lines that were fine ÷ all flags; null until there is a flag. */
  falseFlagRate: number | null;
  weakSpot: ErrorType | null;
  daily: DailyStatus;
  practice: { usedToday: number; limit: number };
  percentile: PercentileStatus;
  /** Present once there is at least one attempt in the last 7 days; details are a Pro feature. */
  debrief: WeeklyDebrief | null;
}

// ───────────────────────────── Defend your work ─────────────────────────────

/** Who will read the document: it sets the angle of the questions. */
export const REHEARSAL_READERS = ["manager", "client", "leadership"] as const;
export type RehearsalReader = (typeof REHEARSAL_READERS)[number];

export const RehearsalRequestSchema = z.object({
  text: z.string().trim().min(REHEARSAL_TEXT_MIN).max(REHEARSAL_TEXT_MAX),
  reader: z.enum(REHEARSAL_READERS).optional(),
});

/** How many rehearsals this session can still start, and what a pack costs. */
export interface DefendStatus {
  remaining: number;
  /** True until the free rehearsal is used. */
  freeAvailable: boolean;
  pack: { size: number; price: number };
}

export interface RehearsalResponse {
  id: string;
  questions: RehearsalQuestion[];
  /** "llm": written by a model and checked against the text; "rules": written by the rule-based fallback. */
  writtenBy: "llm" | "rules";
  status: DefendStatus;
}

/**
 * The document is never stored, so the questions travel back with the answers.
 * One scored round per rehearsal.
 */
export const RehearsalGradeRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(8),
        kind: ErrorTypeSchema,
        quote: z.string().min(1).max(QUOTE_MAX),
        question: z.string().min(1).max(QUESTION_MAX),
        answer: z.string().max(ANSWER_MAX),
      }),
    )
    .min(1)
    .max(REHEARSAL_QUESTIONS),
});

export interface RehearsalGradeResponse {
  results: AnswerVerdict[];
  held: number;
  total: number;
  gradedBy: "llm" | "rules";
}

// ───────────────────────────── Checkout, events, surveys, reports ─────────────────────────────

export const CheckoutRequestSchema = z.object({ plan: z.enum(["annual", "monthly"]) });
export interface CheckoutResponse {
  plan: "trial";
  planChoice: "annual" | "monthly";
  trialEndsAt: string;
}

/** Events the browser may report. Server-side events (drill_submit, trial_start, …) are logged by the server. */
export const CLIENT_EVENTS = [
  "landing_view",
  "scan_start",
  "map_view",
  "drill_start",
  "result_view",
  "paywall_view",
  "checkout_start",
  "share_click",
  "calendar_add",
  "seo_cta_click",
  "defend_view",
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

export const EventRequestSchema = z.object({
  name: z.enum(CLIENT_EVENTS),
  props: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

export const MicroSurveySchema = z.object({
  kind: z.literal("micro"),
  shippedAiError: z.enum(["yes", "not_sure", "no"]),
  wouldPay: z.enum(["yes", "maybe", "no"]),
});

export const FullSurveySchema = z.object({
  kind: z.literal("full"),
  inUs: z.enum(["yes", "no"]),
  age: z.enum(["25-34", "35-45", "other"]),
  aiWeekly: z.enum(["yes", "no"]),
  hadAiError: z.enum(["yes", "not_sure", "no"]),
  wouldPay: z.enum(["yes", "maybe", "no"]),
  jobTitle: z.string().max(80).optional(),
});

export const SurveyRequestSchema = z.discriminatedUnion("kind", [MicroSurveySchema, FullSurveySchema]);
export type SurveyRequest = z.infer<typeof SurveyRequestSchema>;

export interface ReportResponse {
  publicId: string;
  /** Path of the public, printable report page. */
  path: string;
}

export interface ApiError {
  error: string;
  message?: string;
}
