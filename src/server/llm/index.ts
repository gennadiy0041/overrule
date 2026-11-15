import type { Env } from "../env";
import { createClaudeProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import type { StructuredProvider } from "./types";

export * from "./types";
export { callStructured } from "./call";
export { createClaudeProvider } from "./anthropic";
export { createGeminiProvider } from "./gemini";
export { toAnthropicInputSchema, toAnthropicStrictSchema, toGeminiSchema } from "./schema";
export { generateDrill, type GeneratedDrill, type GenerateDrillDeps, type GenerationStage } from "./generate";
export { gradeWhy, type WhyItem } from "./gradeWhy";
export { crossCheckDrill, buildSolverPrompt, CROSS_CHECK_PASS_RATE, type CrossCheckResult } from "./crossCheck";
export type { GenerateDrillInput } from "./prompts";
export { estimateCostUsd, priceOf, type TokenPrice } from "./pricing";

export interface ProviderSet {
  claude?: StructuredProvider;
  /** Cheaper Claude model for grading the short "why" notes; defaults to the main model. */
  claudeFast?: StructuredProvider;
  gemini?: StructuredProvider;
}

/** Build the providers that have a key. Without any key the product runs from the verified pool. */
export function createProviders(
  env: Pick<Env, "ANTHROPIC_API_KEY" | "GEMINI_API_KEY" | "CLAUDE_MODEL" | "CLAUDE_FAST_MODEL" | "GEMINI_MODEL">,
): ProviderSet {
  const providers: ProviderSet = {};
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    providers.claude = createClaudeProvider({ apiKey: anthropicKey, model: env.CLAUDE_MODEL });
    providers.claudeFast = createClaudeProvider({
      apiKey: anthropicKey,
      model: env.CLAUDE_FAST_MODEL?.trim() || env.CLAUDE_MODEL,
    });
  }
  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (geminiKey) providers.gemini = createGeminiProvider({ apiKey: geminiKey, model: env.GEMINI_MODEL });
  return providers;
}
