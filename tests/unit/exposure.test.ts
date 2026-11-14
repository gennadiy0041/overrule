import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  labelShares,
  occupationBeta,
  percentileBelow,
  personalBeta,
  weightedExposure,
} from "../../src/engine/exposure";
import type { OccupationsFile } from "../../src/engine/occupations";
import { parseTable } from "../../scripts/lib/delimited";

const DATA = join(import.meta.dir, "..", "..", "data");
const file = (await Bun.file(join(DATA, "occupations.json")).json()) as OccupationsFile;
const published = parseTable(await Bun.file(join(DATA, "raw", "occ_level.csv")).text(), ",");
const bySoc = new Map(file.occupations.map((o) => [o.soc, o]));

describe("occupation β reproduces the published dataset", () => {
  test("covers all 923 occupations and 19,265 tasks", () => {
    expect(file.occupations.length).toBe(923);
    expect(published.length).toBe(923);
    expect(file.occupations.reduce((n, o) => n + o.tasks.length, 0)).toBe(19265);
  });

  test("matches human_rating_beta for every occupation (|Δ| < 1e-9)", () => {
    let worst = 0;
    for (const row of published) {
      const occupation = bySoc.get(row["O*NET-SOC Code"]!);
      expect(occupation).toBeDefined();
      const delta = Math.abs(occupationBeta(occupation!.tasks) - Number(row["human_rating_beta"]));
      worst = Math.max(worst, delta);
    }
    expect(worst).toBeLessThan(1e-9);
  });

  test("stored β equals the recomputed β", () => {
    for (const occupation of file.occupations) {
      expect(occupation.beta).toBe(occupationBeta(occupation.tasks));
    }
  });
});

describe("percentiles", () => {
  const publishedBetas = published.map((r) => Number(r["human_rating_beta"]));

  // Reference values computed independently from occ_level.csv.
  const reference: Array<[soc: string, title: string, beta: number, percentile: number]> = [
    ["11-2021.00", "Marketing Managers", 0.578, 89.7],
    ["13-1161.00", "Market Research Analysts and Marketing Specialists", 0.577, 89.5],
    ["13-2011.00", "Accountants and Auditors", 0.52, 82.6],
    ["13-1071.00", "Human Resources Specialists", 0.589, 90.6],
    ["13-1082.00", "Project Management Specialists", 0.4, 64.1],
    ["43-4051.00", "Customer Service Representatives", 0.705, 98.0],
  ];

  test.each(reference)("%s %s → β %d, above %d%% of occupations", (soc, title, beta, percentile) => {
    const occupation = bySoc.get(soc)!;
    expect(occupation.title).toBe(title);
    expect(occupation.beta).toBeCloseTo(beta, 3);
    expect(Number(occupation.percentile.toFixed(1))).toBe(percentile);
  });

  test("ties are exact: a float artifact in the published CSV does not leak into percentiles", () => {
    // occ_level.csv stores Pharmacists as 0.39999999999999997 although its tasks give exactly 0.4.
    // Ranking on the raw CSV floats would count it as "below" every other 0.4 occupation
    // (593 instead of 592 of 923). We rank on β recomputed from the task labels instead.
    const pharmacists = published.find((r) => r["O*NET-SOC Code"] === "29-1051.00")!;
    expect(Number(pharmacists["human_rating_beta"])).toBeLessThan(0.4);
    expect(bySoc.get("29-1051.00")!.beta).toBe(0.4);

    const projectManagers = bySoc.get("13-1082.00")!;
    expect(Number(percentileBelow(projectManagers.beta, publishedBetas).toFixed(1))).toBe(64.2);
    expect(Number(projectManagers.percentile.toFixed(1))).toBe(64.1);
  });

  test("median β across occupations is 0.306", () => {
    expect(file.medianBeta).toBeCloseTo(0.306, 3);
  });

  test("percentileBelow counts strictly smaller values only", () => {
    expect(percentileBelow(2, [1, 2, 2, 3])).toBe(25);
    expect(percentileBelow(0, [1, 2])).toBe(0);
    expect(percentileBelow(5, [])).toBe(0);
  });
});

describe("personal exposure", () => {
  test("weights tasks by frequency: often=3, sometimes=2, rarely=1", () => {
    const beta = personalBeta([
      { label: "E1", frequency: "often" }, // 3 × 1
      { label: "E2", frequency: "sometimes" }, // 2 × 0.5
      { label: "E0", frequency: "rarely" }, // 1 × 0
    ]);
    expect(beta).toBeCloseTo(4 / 6, 12);
  });

  test("requires at least three tasks", () => {
    expect(() =>
      personalBeta([
        { label: "E1", frequency: "often" },
        { label: "E0", frequency: "often" },
      ]),
    ).toThrow(RangeError);
  });

  test("weightedExposure of nothing is 0", () => {
    expect(weightedExposure([])).toBe(0);
  });

  test("labelShares splits weight by label", () => {
    const shares = labelShares([
      { label: "E1", weight: 3 },
      { label: "E0", weight: 1 },
    ]);
    expect(shares).toEqual({ E0: 0.25, E1: 0.75, E2: 0 });
  });
});
