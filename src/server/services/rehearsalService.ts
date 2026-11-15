import { heuristicQuestions, heuristicVerdict, type AnswerVerdict, type RehearsalQuestion } from "../../engine/rehearsal";
import type {
  DefendStatus,
  RehearsalGradeResponse,
  RehearsalReader,
  RehearsalResponse,
} from "../../shared/api";
import { FREE_REHEARSALS, REHEARSAL_PACK } from "../../shared/pricing";
import { gradeAnswers, writeQuestions, type AnsweredQuestion } from "../llm/rehearse";
import type { LlmLogger } from "../llm/types";
import type { EventRepo } from "../repos/events";
import type { RehearsalRepo, RehearsalSource } from "../repos/rehearsals";
import type { Session } from "../repos/sessions";
import type { ModelBudget } from "./budget";
import { ServiceError, type Providers } from "./drillService";

/**
 * What one rehearsal can cost at the very worst: the questions from the main model
 * running to its output ceiling, and the scored round from the fast one.
 */
export const REHEARSAL_WRITE_RESERVE_USD = 0.1;
export const REHEARSAL_GRADE_RESERVE_USD = 0.03;

/** Caps on model-written rehearsals; past them the rule-based writer takes over. */
const MODEL_WRITES_PER_SESSION_PER_DAY = 10;
const MODEL_WRITES_PER_HOUR = 40;
const HOUR_MS = 60 * 60 * 1000;

export interface RehearsalServiceDeps {
  now: () => Date;
  rehearsals: RehearsalRepo;
  events: EventRepo;
  providers: Providers;
  llmLog: LlmLogger;
  budget: ModelBudget;
}

/**
 * "Defend your work": five questions about a document a person is about to send,
 * then one scored round of answers.
 *
 * The model writes and judges; code decides what is kept. Our own traffic, a spent
 * budget, a provider failure or a set of questions that does not quote the document
 * all end the same way — the rule-based writer and scorer take over, and the person
 * still gets a rehearsal.
 */
export class RehearsalService {
  constructor(private readonly deps: RehearsalServiceDeps) {}

  status(session: Pick<Session, "id">): DefendStatus {
    const started = this.deps.rehearsals.started(session.id);
    const remaining = FREE_REHEARSALS + this.deps.rehearsals.purchased(session.id) - started;
    return {
      remaining: Math.max(0, remaining),
      freeAvailable: started < FREE_REHEARSALS,
      pack: { size: REHEARSAL_PACK.size, price: REHEARSAL_PACK.price },
    };
  }

  /** Write the questions. The document is used for this call and not kept. */
  async start(session: Session, text: string, reader: RehearsalReader): Promise<RehearsalResponse> {
    if (this.status(session).remaining <= 0) throw new ServiceError(402, "pack_required");

    const fromModel = this.mayWriteWithModel(session)
      ? await writeQuestions(text, reader, { provider: this.deps.providers.claude!, log: this.deps.llmLog })
      : null;
    const questions: RehearsalQuestion[] = fromModel ?? heuristicQuestions(text);
    const writtenBy: RehearsalSource = fromModel ? "llm" : "rules";

    const now = this.deps.now();
    const id = crypto.randomUUID();
    this.deps.rehearsals.create({ id, sessionId: session.id, writtenBy, questions: questions.length, now });
    this.deps.events.log(session.id, "rehearsal_start", now, { writtenBy, reader, chars: text.length });
    return { id, questions, writtenBy, status: this.status(session) };
  }

  /** Score the answers: one round per rehearsal. */
  async grade(session: Session, id: string, items: ReadonlyArray<AnsweredQuestion>): Promise<RehearsalGradeResponse> {
    const rehearsal = this.deps.rehearsals.find(id);
    if (!rehearsal || rehearsal.sessionId !== session.id) throw new ServiceError(404, "not_found");
    if (rehearsal.gradedBy !== null) throw new ServiceError(409, "already_graded");

    // An unanswered question is open by definition; the model is only asked about real answers.
    const answered = items.filter((item) => item.answer.trim() !== "");
    const mayUseModel =
      answered.length > 0 && !session.isInternal && this.deps.budget.allows(REHEARSAL_GRADE_RESERVE_USD);
    const provider = mayUseModel ? (this.deps.providers.claudeFast ?? this.deps.providers.claude) : undefined;
    const fromModel = provider ? await gradeAnswers(answered, { provider, log: this.deps.llmLog }) : null;

    const byId = new Map<string, AnswerVerdict>((fromModel ?? []).map((verdict) => [verdict.id, verdict]));
    const results = items.map((item) => byId.get(item.id) ?? heuristicVerdict(item, item.answer));
    const held = results.filter((result) => result.verdict === "holds").length;
    const gradedBy: RehearsalSource = fromModel ? "llm" : "rules";

    const now = this.deps.now();
    if (!this.deps.rehearsals.markGraded(id, gradedBy, held, now)) throw new ServiceError(409, "already_graded");
    this.deps.events.log(session.id, "rehearsal_graded", now, { gradedBy, held, total: results.length });
    return { results, held, total: results.length, gradedBy };
  }

  /** Demo checkout for a pack: no payment is collected, the rehearsals are added. */
  buyPack(session: Session): DefendStatus {
    const now = this.deps.now();
    this.deps.rehearsals.addPack(session.id, REHEARSAL_PACK.size, REHEARSAL_PACK.price, now);
    this.deps.events.log(session.id, "pack_purchase", now, { size: REHEARSAL_PACK.size, price: REHEARSAL_PACK.price });
    return this.status(session);
  }

  private mayWriteWithModel(session: Session): boolean {
    if (session.isInternal || !this.deps.providers.claude) return false;
    const now = this.deps.now().getTime();
    const { rehearsals, budget } = this.deps;
    return (
      rehearsals.writtenByModelSince(session.id, new Date(now - 24 * HOUR_MS)) < MODEL_WRITES_PER_SESSION_PER_DAY &&
      rehearsals.writtenByModelSinceAll(new Date(now - HOUR_MS)) < MODEL_WRITES_PER_HOUR &&
      budget.allows(REHEARSAL_WRITE_RESERVE_USD)
    );
  }
}
