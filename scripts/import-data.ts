/**
 * Builds data/occupations.json and data/alt-titles.json from the raw datasets.
 *
 *   data/raw/full_labelset.tsv        — openai/GPTs-are-GPTs (MIT): 19,265 task rows
 *   data/raw/occ_level.csv            — published occupation-level scores (used by tests)
 *   data/raw/onet_alternate_titles.txt — O*NET 30.0 Alternate Titles (CC BY 4.0)
 *   data/short-task-names.json        — optional { [taskId]: "3–6 word name" }
 *
 * Run: bun run import-data
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { occupationBeta, percentileBelow, type ExposureLabel, type TaskType } from "../src/engine/exposure";
import { median, slugify, type Occupation, type OccupationsFile } from "../src/engine/occupations";
import { parseTable } from "./lib/delimited";

const DATA = join(import.meta.dir, "..", "data");
const RAW = join(DATA, "raw");

function asLabel(value: string, context: string): ExposureLabel {
  if (value === "E0" || value === "E1" || value === "E2") return value;
  throw new Error(`Unexpected exposure label "${value}" (${context})`);
}

function asTaskType(value: string): TaskType {
  return value === "Core" || value === "Supplemental" ? value : null;
}

async function readShortNames(): Promise<Record<string, string>> {
  const path = join(DATA, "short-task-names.json");
  return existsSync(path) ? ((await Bun.file(path).json()) as Record<string, string>) : {};
}

async function buildOccupations(): Promise<OccupationsFile> {
  const rows = parseTable(await Bun.file(join(RAW, "full_labelset.tsv")).text(), "\t");
  const shortNames = await readShortNames();

  const bySoc = new Map<string, Occupation>();
  for (const row of rows) {
    const soc = row["O*NET-SOC Code"]!;
    const taskId = Math.round(Number(row["Task ID"]));
    let occupation = bySoc.get(soc);
    if (!occupation) {
      occupation = { soc, title: row["Title"]!, slug: "", beta: 0, percentile: 0, tasks: [] };
      bySoc.set(soc, occupation);
    }
    const short = shortNames[String(taskId)];
    occupation.tasks.push({
      id: taskId,
      text: row["Task"]!.trim(),
      ...(short ? { short } : {}),
      type: asTaskType(row["Task Type"]!),
      label: asLabel(row["human_exposure_agg"]!, `task ${taskId}`),
      gpt4: asLabel(row["gpt4_exposure"]!, `task ${taskId} gpt4`),
    });
  }

  const occupations = [...bySoc.values()];
  const usedSlugs = new Set<string>();
  for (const occupation of occupations) {
    occupation.beta = occupationBeta(occupation.tasks);
    let slug = slugify(occupation.title);
    if (usedSlugs.has(slug)) slug = `${slug}-${occupation.soc.replace(/\D/g, "")}`;
    usedSlugs.add(slug);
    occupation.slug = slug;
  }
  const betas = occupations.map((o) => o.beta);
  for (const occupation of occupations) occupation.percentile = percentileBelow(occupation.beta, betas);

  return {
    source: {
      dataset: "https://github.com/openai/GPTs-are-GPTs (MIT)",
      paper: "Eloundou, Manning, Mishkin, Rock (2023). GPTs are GPTs. arXiv:2303.10130",
      taskStatements: "O*NET 27.2 Database, U.S. Department of Labor / O*NET (CC BY 4.0)",
    },
    medianBeta: median(betas),
    occupations,
  };
}

/** Alternate job titles for the occupations we cover: { soc: [title, …] }. */
async function buildAltTitles(socs: ReadonlySet<string>): Promise<Record<string, string[]>> {
  const path = join(RAW, "onet_alternate_titles.txt");
  if (!existsSync(path)) return {};
  const rows = parseTable(await Bun.file(path).text(), "\t");
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    const soc = row["O*NET-SOC Code"]!;
    const title = row["Alternate Title"]?.trim();
    if (!title || !socs.has(soc)) continue;
    (out[soc] ??= []).push(title);
  }
  return out;
}

const file = await buildOccupations();
const altTitles = await buildAltTitles(new Set(file.occupations.map((o) => o.soc)));

await Bun.write(join(DATA, "occupations.json"), JSON.stringify(file));
await Bun.write(join(DATA, "alt-titles.json"), JSON.stringify(altTitles));

const taskCount = file.occupations.reduce((n, o) => n + o.tasks.length, 0);
const altCount = Object.values(altTitles).reduce((n, t) => n + t.length, 0);
console.log(
  `occupations: ${file.occupations.length} · tasks: ${taskCount} · median β: ${file.medianBeta.toFixed(3)} · ` +
    `alternate titles: ${altCount} across ${Object.keys(altTitles).length} occupations`,
);
