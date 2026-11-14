/**
 * Builds the verified drill pool (data/pool/<soc>.json) with the real models.
 *
 * For each launch occupation: the top AI-exposed tasks × the requested levels.
 * Every slot goes through the same pipeline as a live drill (generate → verifyDrill
 * → retry → second provider) and then one extra gate: a different model solves the
 * drill blind and must find at least half of the planted mistakes.
 *
 *   railway run bun scripts/generate-pool.ts [soc …] [--levels=2,3] [--tasks=5] [--force] [--concurrency=4]
 *
 * Resumable: slots that already hold an accepted drill are skipped unless --force.
 * Honest counts of generated / accepted / rejected drafts go to data/pool/stats.json.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ERROR_TYPES, type Drill, type ErrorType, type Level } from "../src/engine/drillSchema";
import { STARTER_OCCUPATIONS, type Occupation, type OccupationsFile, type OccupationTask } from "../src/engine/occupations";
import { verifyDrill } from "../src/engine/verifyDrill";
import { loadEnv } from "../src/server/env";
import {
  createClaudeProvider,
  createProviders,
  crossCheckDrill,
  generateDrill,
  type LlmCallRecord,
  type StructuredProvider,
} from "../src/server/llm";

const DATA = join(import.meta.dir, "..", "data");
const POOL = join(DATA, "pool");
/** Generation rounds per slot before giving up on it. */
const MAX_ROUNDS = 3;

// ───────────────────────────── Pure helpers ─────────────────────────────

interface Slot {
  occupation: Occupation;
  task: OccupationTask;
  level: Level;
  id: string;
  requiredTypes: ErrorType[];
}

export function drillId(soc: string, taskId: number, level: Level): string {
  return `pool-${soc.replace(/\D/g, "")}-${taskId}-l${level}`;
}

/** AI-exposed tasks, most central first: Core before Supplemental, E1 before E2, then dataset order. */
export function topExposedTasks(occupation: Occupation, count: number): OccupationTask[] {
  return occupation.tasks
    .filter((task) => task.label !== "E0")
    .map((task, index) => ({ task, index }))
    .sort(
      (a, b) =>
        Number(b.task.type === "Core") - Number(a.task.type === "Core") ||
        Number(b.task.label === "E1") - Number(a.task.label === "E1") ||
        a.index - b.index,
    )
    .slice(0, count)
    .map((entry) => entry.task);
}

/** Rotate through triples of mistake types so the pool covers all five evenly. */
export function typesForSlot(index: number): ErrorType[] {
  return [0, 1, 2].map((offset) => ERROR_TYPES[(index * 2 + offset) % ERROR_TYPES.length]!);
}

export function planSlots(occupation: Occupation, taskCount: number, levels: ReadonlyArray<Level>): Slot[] {
  const slots: Slot[] = [];
  for (const task of topExposedTasks(occupation, taskCount)) {
    for (const level of levels) {
      slots.push({
        occupation,
        task,
        level,
        id: drillId(occupation.soc, task.id, level),
        requiredTypes: typesForSlot(slots.length),
      });
    }
  }
  return slots;
}

interface OccupationStats {
  soc: string;
  occupation: string;
  slots: number;
  accepted: number;
  /** Model drafts requested, including rejected ones. */
  generated: number;
  rejectedByVerify: number;
  providerErrors: number;
  rejectedByCrossCheck: number;
  crossCheckedBy: Record<string, number>;
}

interface StatsFile {
  updatedAt: string;
  models: Record<string, string>;
  perOccupation: OccupationStats[];
  totals: Omit<OccupationStats, "soc" | "occupation" | "crossCheckedBy">;
  /** Anything a reader of the numbers must know, e.g. drills that entered the pool another way. */
  notes?: string[];
}

function emptyStats(occupation: Occupation): OccupationStats {
  return {
    soc: occupation.soc,
    occupation: occupation.title,
    slots: 0,
    accepted: 0,
    generated: 0,
    rejectedByVerify: 0,
    providerErrors: 0,
    rejectedByCrossCheck: 0,
    crossCheckedBy: {},
  };
}

export function totalsOf(all: ReadonlyArray<OccupationStats>): StatsFile["totals"] {
  const sum = (pick: (s: OccupationStats) => number) => all.reduce((n, s) => n + pick(s), 0);
  return {
    slots: sum((s) => s.slots),
    accepted: sum((s) => s.accepted),
    generated: sum((s) => s.generated),
    rejectedByVerify: sum((s) => s.rejectedByVerify),
    providerErrors: sum((s) => s.providerErrors),
    rejectedByCrossCheck: sum((s) => s.rejectedByCrossCheck),
  };
}

// ───────────────────────────── I/O ─────────────────────────────

interface PoolFile {
  soc: string;
  occupation: string;
  drills: Drill[];
}

async function readPoolFile(occupation: Occupation): Promise<PoolFile> {
  const path = join(POOL, `${occupation.soc}.json`);
  if (!existsSync(path)) return { soc: occupation.soc, occupation: occupation.title, drills: [] };
  return (await Bun.file(path).json()) as PoolFile;
}

async function writePoolFile(file: PoolFile): Promise<void> {
  const drills = [...file.drills].sort((a, b) => a.id.localeCompare(b.id));
  await Bun.write(join(POOL, `${file.soc}.json`), `${JSON.stringify({ ...file, drills }, null, 2)}\n`);
}

function parseArgs(argv: ReadonlyArray<string>) {
  const flags = new Map<string, string>();
  const socs: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [name, value = "true"] = arg.slice(2).split("=");
      flags.set(name!, value);
    } else socs.push(arg);
  }
  return {
    socs,
    levels: (flags.get("levels") ?? "2,3").split(",").map(Number) as Level[],
    tasks: Number(flags.get("tasks") ?? 5),
    force: flags.has("force"),
    concurrency: Number(flags.get("concurrency") ?? 4),
  };
}

async function runPool<T>(items: ReadonlyArray<T>, concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const providers = createProviders(env);
  if (!providers.claude && !providers.gemini) {
    console.error("No model keys in the environment. Run through: railway run bun scripts/generate-pool.ts");
    process.exit(1);
  }
  // A second Claude model, so the blind solver differs from the writer even when Gemini is down.
  const crossCheckModel = process.env["CROSS_CHECK_MODEL"] ?? "claude-haiku-5-5";
  const claudeSolver =
    env.ANTHROPIC_API_KEY && crossCheckModel !== env.CLAUDE_MODEL
      ? createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, model: crossCheckModel })
      : undefined;

  const file = (await Bun.file(join(DATA, "occupations.json")).json()) as OccupationsFile;
  const wanted = args.socs.length > 0 ? args.socs : STARTER_OCCUPATIONS.map((o) => o.soc);
  const statsPath = join(POOL, "stats.json");
  const previous: StatsFile | null = existsSync(statsPath) ? ((await Bun.file(statsPath).json()) as StatsFile) : null;
  const statsBySoc = new Map((previous?.perOccupation ?? []).map((s) => [s.soc, s]));

  for (const soc of wanted) {
    const occupation = file.occupations.find((o) => o.soc === soc);
    if (!occupation) {
      console.error(`Unknown occupation ${soc}`);
      continue;
    }
    const pool = await readPoolFile(occupation);
    const stats = statsBySoc.get(soc) ?? emptyStats(occupation);
    statsBySoc.set(soc, stats);
    const slots = planSlots(occupation, args.tasks, args.levels);
    const todo = slots.filter((slot) => args.force || !pool.drills.some((d) => d.id === slot.id));
    console.log(`${occupation.title}: ${slots.length} slots, ${todo.length} to generate`);

    await runPool(todo, args.concurrency, async (slot) => {
      const started = Date.now();
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const records: LlmCallRecord[] = [];
        const generated = await generateDrill(
          {
            soc: occupation.soc,
            occupation: occupation.title,
            taskId: slot.task.id,
            task: slot.task.text,
            level: slot.level,
            requiredTypes: slot.requiredTypes,
            avoidTitles: pool.drills.map((d) => d.artifact.title),
          },
          {
            ...(providers.claude ? { primary: providers.claude } : {}),
            ...(providers.gemini ? { secondary: providers.gemini } : {}),
            log: (record) => records.push(record),
            newId: () => slot.id,
          },
        );
        const drafts = records.filter((r) => r.purpose === "generate");
        stats.generated += drafts.length;
        stats.rejectedByVerify += drafts.filter((r) => !r.ok && r.error?.startsWith("verify:")).length;
        stats.providerErrors += drafts.filter((r) => !r.ok && !r.error?.startsWith("verify:")).length;
        for (const r of drafts.filter((d) => !d.ok)) console.log(`    ${slot.id} draft rejected: ${r.error}`);
        if (!generated) continue;

        // Blind cross-check by a different model than the writer, falling back to the same family.
        const solvers: StructuredProvider[] = (
          generated.provider === "claude"
            ? [providers.gemini, claudeSolver, providers.claude]
            : [providers.claude, claudeSolver, providers.gemini]
        ).filter((p): p is StructuredProvider => p !== undefined);
        let verdict: { passed: boolean; by: string; found: number; total: number } | null = null;
        for (const solver of solvers) {
          try {
            const check = await crossCheckDrill(generated.drill, { solver, log: () => undefined });
            verdict = { passed: check.passed, by: solver.model, found: check.found, total: check.total };
            break;
          } catch {
            // Try the next solver.
          }
        }
        if (verdict && !verdict.passed) {
          stats.rejectedByCrossCheck++;
          console.log(`    ${slot.id} cross-check failed (${verdict.found}/${verdict.total} by ${verdict.by})`);
          continue;
        }
        if (!verifyDrill(generated.drill).ok) continue;

        const by = verdict?.by ?? "none";
        stats.crossCheckedBy[by] = (stats.crossCheckedBy[by] ?? 0) + 1;
        pool.drills = [...pool.drills.filter((d) => d.id !== slot.id), generated.drill];
        await writePoolFile(pool);
        console.log(
          `  ✓ ${slot.id} · ${generated.provider} · cross-check ${verdict ? `${verdict.found}/${verdict.total} by ${by}` : "unavailable"} · ${Math.round((Date.now() - started) / 1000)} s`,
        );
        return;
      }
      console.log(`  ✗ ${slot.id} not filled after ${MAX_ROUNDS} rounds`);
    });

    stats.slots = slots.length;
    stats.accepted = pool.drills.length;
    const all = [...statsBySoc.values()];
    const out: StatsFile = {
      updatedAt: new Date().toISOString(),
      models: { claude: env.CLAUDE_MODEL, gemini: env.GEMINI_MODEL, crossCheckFallback: crossCheckModel },
      perOccupation: all,
      totals: totalsOf(all),
      ...(previous?.notes ? { notes: previous.notes } : {}),
    };
    await Bun.write(statsPath, `${JSON.stringify(out, null, 2)}\n`);
  }
  console.log("done");
}
