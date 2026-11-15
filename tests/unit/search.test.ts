/**
 * Job-title search against the real data: 923 official titles, ~48,500 O*NET
 * alternate titles and the modern-titles dictionary.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LEADERSHIP_ROLES, type OccupationsFile } from "../../src/engine/occupations";
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

describe("leadership titles", () => {
  // Each title lands on the occupation whose documents that person signs off.
  test.each([
    ["ceo", "11-1011.00"],
    ["chief executive officer", "11-1011.00"],
    ["founder", "11-1011.00"],
    ["co-founder", "11-1011.00"],
    ["cofounder", "11-1011.00"],
    ["business owner", "11-1011.00"],
    ["entrepreneur", "11-1011.00"],
    ["president", "11-1011.00"],
    ["managing director", "11-1011.00"],
    ["executive director", "11-1011.00"],
    ["chairman", "11-1011.00"],
    ["board member", "11-1011.00"],
    ["vice president", "11-1011.00"],
    ["vp", "11-1011.00"],
    ["svp", "11-1011.00"],
    ["executive", "11-1011.00"],
    ["coo", "11-1021.00"],
    ["chief operating officer", "11-1021.00"],
    ["operations director", "11-1021.00"],
    ["director of operations", "11-1021.00"],
    ["head of operations", "11-1021.00"],
    ["general manager", "11-1021.00"],
    ["director", "11-1021.00"],
    ["department head", "11-1021.00"],
    ["country manager", "11-1021.00"],
    ["senior manager", "11-1021.00"],
    ["manager", "11-1021.00"],
    ["team lead", "11-1021.00"],
    ["cfo", "11-3031.00"],
    ["chief financial officer", "11-3031.00"],
    ["finance director", "11-3031.00"],
    ["head of finance", "11-3031.00"],
    ["cto", "11-3021.00"],
    ["chief technology officer", "11-3021.00"],
    ["cio", "11-3021.00"],
    ["ciso", "11-3021.00"],
    ["it director", "11-3021.00"],
    ["vp engineering", "11-3021.00"],
    ["head of engineering", "11-3021.00"],
    ["cmo", "11-2021.00"],
    ["chief marketing officer", "11-2021.00"],
    ["marketing director", "11-2021.00"],
    ["head of product", "11-2021.00"],
    ["chief product officer", "11-2021.00"],
    ["cro", "11-2022.00"],
    ["chief revenue officer", "11-2022.00"],
    ["sales director", "11-2022.00"],
    ["vp of sales", "11-2022.00"],
    ["head of sales", "11-2022.00"],
    ["chro", "11-3121.00"],
    ["chief people officer", "11-3121.00"],
    ["hr director", "11-3121.00"],
    ["head of hr", "11-3121.00"],
    ["chief medical officer", "11-9111.00"],
    ["chief compliance officer", "11-9199.02"],
    ["plant manager", "11-3051.00"],
    ["head of supply chain", "11-3071.04"],
    ["school principal", "11-9032.00"],
  ])("%s → %s first", (query, soc) => {
    expect(top(query, 1), `${query} → ${titleOf.get(top(query, 1)[0] ?? "")}`).toEqual([soc]);
  });

  test("a C-suite title that O*NET files under Chief Executives still offers Chief Executives second", () => {
    expect(top("cfo", 2)).toEqual(["11-3031.00", "11-1011.00"]);
    expect(top("cto", 2)).toEqual(["11-3021.00", "11-1011.00"]);
  });

  test("a film director still finds their own occupation right under the business one", () => {
    expect(top("director", 2)).toContain("27-2012.00");
  });

  test("every title in the dictionary and every suggested leadership role points at an occupation we have", async () => {
    const modern = (await Bun.file(join(DATA, "modern-titles.json")).json()) as Array<{ title: string; soc: string }>;
    for (const { title, soc } of modern) expect(titleOf.has(soc), `${title} → ${soc}`).toBe(true);
    for (const role of LEADERSHIP_ROLES) expect(titleOf.has(role.soc), `${role.label} → ${role.soc}`).toBe(true);
    // No title is listed twice with two different occupations.
    const seen = new Map<string, string>();
    for (const { title, soc } of modern) {
      expect(seen.get(title) ?? soc, `${title} is listed for two occupations`).toBe(soc);
      seen.set(title, soc);
    }
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
