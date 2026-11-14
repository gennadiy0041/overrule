/**
 * Live smoke test of the model layer: generates one drill with the real providers,
 * verifies it, grades two sample notes and cross-checks the drill blind.
 *
 *   railway run bun scripts/llm-smoke.ts [--provider=claude|gemini] [--level=2] [--print]
 *
 * Prints a summary only — never keys or environment values. Exits 1 on failure.
 */
import { join } from "node:path";
import { countWords, type Level } from "../src/engine/drillSchema";
import type { OccupationsFile } from "../src/engine/occupations";
import { loadEnv } from "../src/server/env";
import { createProviders, crossCheckDrill, generateDrill, gradeWhy, type LlmCallRecord } from "../src/server/llm";

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [name, value = ""] = arg.replace(/^--/, "").split("=");
  args.set(name!, value);
}
const forced = args.get("provider");
const level = Number(args.get("level") || 2) as Level;

const providers = createProviders(loadEnv());
const primary = forced === "gemini" ? providers.gemini : providers.claude;
const secondary = forced ? undefined : providers.gemini;
if (!primary) {
  console.error(`No key configured for ${forced ?? "claude"}. Run through: railway run bun scripts/llm-smoke.ts`);
  process.exit(1);
}

const file = (await Bun.file(join(import.meta.dir, "..", "data", "occupations.json")).json()) as OccupationsFile;
const occupation = file.occupations.find((o) => o.soc === "11-2021.00")!;
const task = occupation.tasks.find((t) => t.id === 952) ?? occupation.tasks.find((t) => t.label !== "E0")!;

const calls: LlmCallRecord[] = [];
const log = (record: LlmCallRecord) => {
  calls.push(record);
  console.log(
    `  ${record.purpose} · ${record.provider} · ${Math.round(record.ms)} ms · ${record.ok ? "ok" : `FAILED (${record.error})`}` +
      ` · tokens ${record.inputTokens ?? "?"}/${record.outputTokens ?? "?"}`,
  );
};

console.log(`Generating a level-${level} drill for ${occupation.title} with ${primary.name} (${primary.model})…`);
const generated = await generateDrill(
  { soc: occupation.soc, occupation: occupation.title, taskId: task.id, task: task.text, level, requiredTypes: ["numbers"] },
  {
    primary,
    ...(secondary ? { secondary } : {}),
    log,
    newId: () => `smoke-${Date.now()}`,
    onStage: (stage) => console.log(`  stage: ${stage}`),
  },
);
if (!generated) {
  console.error("No drill passed verification.");
  process.exit(1);
}

const { drill } = generated;
console.log(`verified: yes · by ${generated.provider} · attempts ${generated.attempts}`);
console.log(`title: ${drill.artifact.title} (${drill.artifact.kind}, ${countWords(drill.artifact)} words)`);
console.log(`mistakes: ${drill.key.map((k) => `${k.type}@${k.targetId}`).join(", ")} · decoys: ${drill.decoys.length} · numeric checks: ${drill.numericChecks.length}`);
if (args.has("print")) console.log(JSON.stringify(drill, null, 2));

const first = drill.key[0]!;
const notes = await gradeWhy(
  [
    { targetId: first.targetId, why: first.cue, explanation: first.explanation, correction: first.correction, cue: first.cue },
    { targetId: "note-2", why: "looks a bit odd to me", explanation: first.explanation, correction: first.correction, cue: first.cue },
  ],
  { ...(providers.claudeFast ? { provider: providers.claudeFast } : {}), log },
);
console.log(`why grades: ${JSON.stringify(notes)}`);

const solver = generated.provider === "claude" ? (providers.gemini ?? providers.claude) : (providers.claude ?? providers.gemini);
if (solver) {
  try {
    const check = await crossCheckDrill(drill, { solver, log });
    console.log(`cross-check by ${solver.name}: found ${check.found}/${check.total} → ${check.passed ? "passed" : "failed"}`);
  } catch (error) {
    console.log(`cross-check by ${solver.name} unavailable: ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`calls: ${calls.length}, failed: ${calls.filter((c) => !c.ok).length}`);
