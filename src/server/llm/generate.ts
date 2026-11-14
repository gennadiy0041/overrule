import { z } from "zod";
import { DrillContentSchema, type Drill } from "../../engine/drillSchema";
import { formatIssues, verifyDrill, type VerifyIssue } from "../../engine/verifyDrill";
import { callStructured } from "./call";
import {
  buildGenerationPrompt,
  buildGenerationSystemPrompt,
  buildRetryPrompt,
  type GenerateDrillInput,
} from "./prompts";
import type { LlmLogger, ProviderName, StructuredProvider } from "./types";

export type GenerationStage = "drafting" | "verifying" | "retrying" | "switching_provider";

export interface GenerateDrillDeps {
  primary?: StructuredProvider;
  secondary?: StructuredProvider;
  log: LlmLogger;
  newId: () => string;
  onStage?: (stage: GenerationStage) => void;
  timeouts?: { primaryMs: number; secondaryMs: number };
}

export interface GeneratedDrill {
  drill: Drill;
  provider: ProviderName;
  model: string;
  /** Model calls it took, across providers. */
  attempts: number;
}

const DEFAULT_TIMEOUTS = { primaryMs: 60_000, secondaryMs: 45_000 };
/** Room for a level-5 document, its key and numeric checks, plus the model's own working-out. */
const MAX_TOKENS = 12_000;
const TOOL_NAME = "emit_drill";

/** The neutral JSON Schema of what the model must return; each provider adapts it to its own dialect. */
const DRILL_JSON_SCHEMA = z.toJSONSchema(DrillContentSchema) as Record<string, unknown>;

type Verdict = { ok: true; drill: Drill } | { ok: false; issues: string; codes: string };

/**
 * Models occasionally return a nested object or array as a JSON-encoded string
 * (`"brief": "{…}"`). That is a transport quirk, not a content problem, so it is
 * undone before validation instead of costing a 30-second retry.
 */
function unwrapStringifiedFields(data: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value;
    if (typeof value !== "string" || !/^\s*[[{]/.test(value)) continue;
    try {
      out[key] = JSON.parse(value) as unknown;
    } catch {
      // Not JSON after all: leave it for the schema to reject.
    }
  }
  return out;
}

/** Run the deterministic verifier, plus the one rule that depends on the request: required mistake types. */
function judgeDraft(data: unknown, input: GenerateDrillInput, id: string): Verdict {
  const candidate =
    typeof data === "object" && data !== null
      ? {
          ...unwrapStringifiedFields(data),
          id,
          soc: input.soc,
          occupation: input.occupation,
          taskId: input.taskId,
          task: input.task,
          level: input.level,
        }
      : data;
  const verdict = verifyDrill(candidate);
  if (!verdict.ok) return { ok: false, issues: formatIssues(verdict.issues), codes: codesOf(verdict.issues) };

  const present = new Set(verdict.drill.key.map((item) => item.type));
  const missing = input.requiredTypes.filter((type) => !present.has(type));
  if (missing.length > 0) {
    return {
      ok: false,
      issues: `- [required_type] The planted mistakes must include these types: ${missing.join(", ")}.`,
      codes: "required_type",
    };
  }
  return verdict;
}

function codesOf(issues: ReadonlyArray<VerifyIssue>): string {
  return [...new Set(issues.map((issue) => issue.code))].join(", ");
}

/**
 * Ask one provider for a draft and verify it. A draft the verifier rejects is
 * logged as a failed call ("verify: …") — it never reaches a user.
 * Throws when the provider itself fails.
 */
async function draft(
  provider: StructuredProvider,
  prompt: string,
  input: GenerateDrillInput,
  deps: GenerateDrillDeps,
  timeoutMs: number,
): Promise<Verdict> {
  const id = deps.newId();
  let verdict: Verdict | undefined;
  deps.onStage?.("drafting");
  await callStructured(
    provider,
    {
      purpose: "generate",
      system: buildGenerationSystemPrompt(),
      prompt,
      toolName: TOOL_NAME,
      toolDescription: "Return the finished document together with its answer key.",
      jsonSchema: DRILL_JSON_SCHEMA,
      maxTokens: MAX_TOKENS,
      timeoutMs,
    },
    deps.log,
    (response) => {
      deps.onStage?.("verifying");
      verdict = judgeDraft(response.data, input, id);
      // The first finding is kept with the codes: /metrics then shows why drafts get rejected.
      return verdict.ok ? undefined : `verify: ${verdict.codes} | ${verdict.issues.split("\n")[0] ?? ""}`;
    },
  );
  // callStructured always runs the judge on a successful call.
  return verdict!;
}

/**
 * Primary provider → (verifier rejects) one retry with the verifier's findings →
 * secondary provider → null. A provider error skips the retry: asking the same
 * failing endpoint again only makes the person wait longer.
 *
 * `null` means "serve a drill from the verified pool"; the user never sees a provider error.
 */
export async function generateDrill(input: GenerateDrillInput, deps: GenerateDrillDeps): Promise<GeneratedDrill | null> {
  const timeouts = deps.timeouts ?? DEFAULT_TIMEOUTS;
  let attempts = 0;
  const accepted = (verdict: Verdict, provider: StructuredProvider): GeneratedDrill | null =>
    verdict.ok ? { drill: verdict.drill, provider: provider.name, model: provider.model, attempts } : null;

  if (deps.primary) {
    try {
      attempts++;
      const first = await draft(deps.primary, buildGenerationPrompt(input), input, deps, timeouts.primaryMs);
      if (first.ok) return accepted(first, deps.primary);

      deps.onStage?.("retrying");
      attempts++;
      const second = await draft(deps.primary, buildRetryPrompt(input, first.issues), input, deps, timeouts.primaryMs);
      if (second.ok) return accepted(second, deps.primary);
    } catch {
      // Already logged by callStructured; fall through to the secondary provider.
    }
  }

  if (deps.secondary) {
    try {
      if (deps.primary) deps.onStage?.("switching_provider");
      attempts++;
      const last = await draft(deps.secondary, buildGenerationPrompt(input), input, deps, timeouts.secondaryMs);
      return accepted(last, deps.secondary);
    } catch {
      return null;
    }
  }
  return null;
}
