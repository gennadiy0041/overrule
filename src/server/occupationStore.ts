import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  STARTER_OCCUPATIONS,
  STARTER_SOCS,
  type Occupation,
  type OccupationsFile,
  type OccupationTask,
} from "../engine/occupations";
import { buildSearchIndex, searchOccupations, type SearchIndex } from "../engine/search";
import type { OccupationDetail, OccupationHit, OccupationSummary, TaskView } from "../shared/api";

interface ModernTitle {
  title: string;
  soc: string;
}

/**
 * The 923 occupations, loaded once at boot and kept in memory (≈3 MB).
 * The browser never downloads this file — it asks for one occupation at a time.
 */
export class OccupationStore {
  readonly all: ReadonlyArray<Occupation>;
  readonly betas: ReadonlyArray<number>;
  readonly medianBeta: number;
  private readonly bySoc: ReadonlyMap<string, Occupation>;
  private readonly bySlug: ReadonlyMap<string, Occupation>;
  private readonly index: SearchIndex;

  constructor(file: OccupationsFile, altTitles: Record<string, string[]>, modernTitles: ModernTitle[]) {
    this.all = file.occupations;
    this.betas = file.occupations.map((o) => o.beta);
    this.medianBeta = file.medianBeta;
    this.bySoc = new Map(file.occupations.map((o) => [o.soc, o]));
    this.bySlug = new Map(file.occupations.map((o) => [o.slug, o]));
    this.index = buildSearchIndex({
      occupations: file.occupations,
      altTitles,
      modernTitles: modernTitles.filter((m) => this.bySoc.has(m.soc)),
    });
  }

  get(soc: string): Occupation | undefined {
    return this.bySoc.get(soc);
  }

  getBySlug(slug: string): Occupation | undefined {
    return this.bySlug.get(slug);
  }

  /** Occupations with a pre-generated drill pool, in launch order. */
  get starters(): Occupation[] {
    return STARTER_OCCUPATIONS.flatMap((s) => this.bySoc.get(s.soc) ?? []);
  }

  /** Free-text job-title search; an empty query suggests the launch occupations. */
  search(query: string, limit = 8): OccupationHit[] {
    if (query.trim().length < 2) {
      return this.starters.map((o) => ({ ...summarize(o), closest: false }));
    }
    return searchOccupations(this.index, query, limit).flatMap((hit) => {
      const occupation = this.bySoc.get(hit.soc);
      if (!occupation) return [];
      return [
        {
          ...summarize(occupation),
          closest: hit.closest,
          ...(hit.matchedTitle ? { matchedTitle: hit.matchedTitle } : {}),
        },
      ];
    });
  }

  /**
   * A short label for share text and headers: "Marketing", "HR", or the official title
   * without its exclusion clause ("Secondary School Teachers, Except Special and …").
   */
  shortName(soc: string): string {
    const starter = STARTER_OCCUPATIONS.find((s) => s.soc === soc);
    return starter?.short ?? this.bySoc.get(soc)?.title.replace(/,\s+Except\b.*$/, "") ?? "My job";
  }
}

export function summarize(occupation: Occupation): OccupationSummary {
  return {
    soc: occupation.soc,
    title: occupation.title,
    slug: occupation.slug,
    beta: occupation.beta,
    percentile: occupation.percentile,
    starter: STARTER_SOCS.has(occupation.soc),
  };
}

export function toTaskView(task: OccupationTask): TaskView {
  return {
    id: task.id,
    text: task.text,
    ...(task.short ? { short: task.short } : {}),
    type: task.type,
    label: task.label,
  };
}

export function toDetail(occupation: Occupation): OccupationDetail {
  // Core tasks first: they are pre-selected in the scan.
  const tasks = [...occupation.tasks].sort((a, b) => Number(b.type === "Core") - Number(a.type === "Core"));
  return { ...summarize(occupation), tasks: tasks.map(toTaskView) };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  return existsSync(path) ? ((await Bun.file(path).json()) as T) : fallback;
}

export async function loadOccupationStore(dataDir: string): Promise<OccupationStore> {
  const file = (await Bun.file(join(dataDir, "occupations.json")).json()) as OccupationsFile;
  const altTitles = await readJson<Record<string, string[]>>(join(dataDir, "alt-titles.json"), {});
  const modernTitles = await readJson<ModernTitle[]>(join(dataDir, "modern-titles.json"), []);
  return new OccupationStore(file, altTitles, modernTitles);
}
