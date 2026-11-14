import type { ExposureLabel, TaskType } from "./exposure";

/** One O*NET task statement with its exposure label. */
export interface OccupationTask {
  /** O*NET Task ID. */
  id: number;
  /** Full O*NET task statement. */
  text: string;
  /** Optional 3–6 word name, generated for the launch occupations. */
  short?: string;
  type: TaskType;
  /** Human-annotated exposure label (`human_exposure_agg`) — the primary label. */
  label: ExposureLabel;
  /** GPT-4 annotated label, kept for reference. */
  gpt4: ExposureLabel;
}

export interface Occupation {
  /** O*NET-SOC code, e.g. "11-2021.00". */
  soc: string;
  title: string;
  slug: string;
  /** Occupation-level β (see engine/exposure). */
  beta: number;
  /** Share (0–100) of the 923 occupations with a strictly lower β. */
  percentile: number;
  tasks: OccupationTask[];
}

export interface OccupationsFile {
  source: { dataset: string; paper: string; taskStatements: string };
  medianBeta: number;
  occupations: Occupation[];
}

/** Occupations with a pre-generated, cross-checked drill pool and short task names. */
export const STARTER_OCCUPATIONS = [
  { soc: "11-2021.00", short: "Marketing" },
  { soc: "13-1161.00", short: "Market Research" },
  { soc: "13-2011.00", short: "Accounting" },
  { soc: "13-1071.00", short: "HR" },
  { soc: "13-1082.00", short: "Project Management" },
  { soc: "43-4051.00", short: "Customer Service" },
] as const;

export const STARTER_SOCS: ReadonlySet<string> = new Set(STARTER_OCCUPATIONS.map((o) => o.soc));

/** URL-safe slug for an occupation title. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
