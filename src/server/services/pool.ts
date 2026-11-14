import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Drill, Level } from "../../engine/drillSchema";
import type { Occupation } from "../../engine/occupations";
import { verifyDrill } from "../../engine/verifyDrill";
import type { DrillRepo } from "../repos/drills";

interface PoolFile {
  soc: string;
  occupation: string;
  drills: unknown[];
}

/**
 * The pre-generated drill pool (data/pool/<soc>.json): the fallback when live
 * generation is unavailable, and the source of the shared Daily Catch for the
 * launch occupations. Every drill is re-verified at boot — a drill that no longer
 * passes `verifyDrill` is never served.
 */
export class DrillPool {
  private readonly bySoc = new Map<string, Drill[]>();
  readonly rejected: string[] = [];

  constructor(drills: ReadonlyArray<Drill>) {
    for (const drill of drills) {
      const list = this.bySoc.get(drill.soc) ?? [];
      list.push(drill);
      this.bySoc.set(drill.soc, list);
    }
    // Stable order: the Daily Catch rotation must not depend on file-system order.
    for (const list of this.bySoc.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  }

  get size(): number {
    let total = 0;
    for (const list of this.bySoc.values()) total += list.length;
    return total;
  }

  get occupations(): string[] {
    return [...this.bySoc.keys()];
  }

  for(soc: string): ReadonlyArray<Drill> {
    return this.bySoc.get(soc) ?? [];
  }

  /**
   * The pooled occupation closest to `occupation`: itself if pooled, otherwise the
   * one sharing the longest SOC prefix (same detailed → minor → major group), ties
   * broken by the smallest gap in AI exposure.
   */
  nearestSoc(occupation: Pick<Occupation, "soc" | "beta">, betaOf: (soc: string) => number | undefined): string | null {
    let best: { soc: string; prefix: number; gap: number } | null = null;
    for (const soc of this.bySoc.keys()) {
      const prefix = sharedPrefixLength(soc, occupation.soc);
      const gap = Math.abs((betaOf(soc) ?? 0) - occupation.beta);
      if (!best || prefix > best.prefix || (prefix === best.prefix && gap < best.gap)) best = { soc, prefix, gap };
    }
    return best?.soc ?? null;
  }
}

function sharedPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Order pool candidates by closeness to the wanted task and level. */
export function rankPoolDrills(drills: ReadonlyArray<Drill>, want: { taskIds: ReadonlySet<number>; level: Level }): Drill[] {
  const distance = (drill: Drill) => (want.taskIds.has(drill.taskId) ? 0 : 10) + Math.abs(drill.level - want.level);
  return [...drills].sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id));
}

export function loadPool(dataDir: string): DrillPool {
  const dir = join(dataDir, "pool");
  const drills: Drill[] = [];
  const rejected: string[] = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (!/^\d{2}-\d{4}\.\d{2}\.json$/.test(name)) continue;
      const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as PoolFile;
      for (const candidate of file.drills) {
        const verdict = verifyDrill(candidate);
        if (verdict.ok) drills.push(verdict.drill);
        else rejected.push(`${name}: ${verdict.issues.map((issue) => issue.code).join(", ")}`);
      }
    }
  }
  const pool = new DrillPool(drills);
  pool.rejected.push(...rejected);
  return pool;
}

/** Mirror the pool into the database so attempts can reference pool drills like any other. */
export function syncPool(pool: DrillPool, repo: DrillRepo, now: Date): void {
  for (const soc of pool.occupations) {
    for (const drill of pool.for(soc)) {
      repo.upsert({ drill, origin: "pool", provider: null, model: null, sessionId: null, createdAt: now.toISOString() });
    }
  }
}
