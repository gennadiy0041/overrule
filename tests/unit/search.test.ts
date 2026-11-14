/**
 * Job-title search against the real data: 923 official titles, ~48,500 O*NET
 * alternate titles and the modern-titles dictionary.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { OccupationsFile } from "../../src/engine/occupations";
import { buildSearchIndex, searchOccupations } from "../../src/engine/search";

const DATA = join(import.meta.dir, "..", "..", "data");
const file = (await Bun.file(join(DATA, "occupations.json")).json()) as OccupationsFile;
const index = buildSearchIndex({
  occupations: file.occupations,
  altTitles: (await Bun.file(join(DATA, "alt-titles.json")).json()) as Record<string, string[]>,
  modernTitles: (await Bun.file(join(DATA, "modern-titles.json")).json()) as Array<{ title: string; soc: string }>,
});
const titleOf = new Map(file.occupations.map((o) => [o.soc, o.title]));
const top = (query: string, count = 3) => searchOccupations(index, query).slice(0, count).map((hit) => hit.soc);

describe("official titles", () => {
  test.each([
    ["marketing manager", "11-2021.00"],
    ["accountant", "13-2011.00"],
    ["human resources specialist", "13-1071.00"],
    ["customer service", "43-4051.00"],
    ["market research", "13-1161.00"],
    ["registered nurse", "29-1141.00"],
  ])("%s → %s first", (query, soc) => {
    expect(top(query, 1), `${query} → ${titleOf.get(top(query, 1)[0] ?? "")}`).toEqual([soc]);
  });

  test("project manager finds Project Management Specialists near the top", () => {
    expect(top("project manager")).toContain("13-1082.00");
  });

  test("partial typing already shows the right job", () => {
    expect(top("acc", 5)).toContain("13-2011.00");
    expect(top("market", 5)).toContain("11-2021.00");
  });
});

describe("the titles people actually use", () => {
  test("a modern title reports what it matched", () => {
    const [hit] = searchOccupations(index, "growth marketer");
    expect(hit?.soc).toBe("11-2021.00");
    expect(hit?.matchedTitle).toBe("growth marketer");
    expect(hit?.closest).toBe(false);
  });

  test.each(["recruiter", "bookkeeper", "software engineer", "data analyst", "paralegal", "executive assistant", "copywriter"])(
    "%s lands on some occupation",
    (query) => {
      expect(searchOccupations(index, query).length).toBeGreaterThan(0);
    },
  );

  test("abbreviations are expanded", () => {
    expect(top("hr specialist", 1)).toEqual(["13-1071.00"]);
  });
});

describe("fuzzy matching and limits", () => {
  test("a typo still finds the job, labelled as a closest match", () => {
    const hits = searchOccupations(index, "acountant").slice(0, 2);
    expect(hits.map((hit) => hit.soc)).toContain("13-2011.00");
    expect(hits.every((hit) => hit.closest)).toBe(true);
    expect(searchOccupations(index, "markting manager")[0]?.soc).toBe("11-2021.00");
  });

  test("nonsense and too-short queries return nothing", () => {
    expect(searchOccupations(index, "zzqqxx")).toEqual([]);
    expect(searchOccupations(index, "a")).toEqual([]);
    expect(searchOccupations(index, "   ")).toEqual([]);
  });

  test("one hit per occupation, and the limit is respected", () => {
    const hits = searchOccupations(index, "manager", 5);
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(new Set(hits.map((hit) => hit.soc)).size).toBe(hits.length);
  });

  test("it is fast enough to run on every keystroke", () => {
    const queries = ["marketing", "account", "nurse", "project man", "customer", "engineer", "teacher", "sales", "data", "hr"];
    const started = performance.now();
    for (let i = 0; i < 200; i++) searchOccupations(index, queries[i % queries.length]!);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
