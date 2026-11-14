# Data sources, licences and attribution

Everything in `data/` and where it comes from.

## 1. Exposure labels — "GPTs are GPTs"

- **Files:** `raw/full_labelset.tsv` (19,265 task rows), `raw/occ_level.csv` (published occupation-level scores, used
  by the unit test that reproduces them).
- **Source:** <https://github.com/openai/GPTs-are-GPTs>, MIT License.
- **Paper:** Tyna Eloundou, Sam Manning, Pamela Mishkin, Daniel Rock. "GPTs are GPTs: An Early Look at the Labor
  Market Impact Potential of Large Language Models." arXiv:2303.10130 (2023).
- **What we use:** the human-annotated label `human_exposure_agg` (E0 / E1 / E2) per task as the primary label, and
  `gpt4_exposure` for reference.

## 2. Task statements and alternate titles — O\*NET

- **Task statements** (`Task`, `Task Type`, `Title`, O\*NET-SOC codes) come with the dataset above and originate
  from the **O\*NET 27.2 Database**.
- **Alternate titles** (`raw/onet_alternate_titles.txt` → `alt-titles.json`) are from the **O\*NET 30.0 Database**,
  downloaded from <https://www.onetcenter.org/database.html>.

Required attribution (wording from <https://www.onetcenter.org/license_db.html>):

> This page includes information from the O\*NET 27.2 Database and the O\*NET 30.0 Database by the U.S. Department
> of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O\*NET® is a
> trademark of USDOL/ETA. Overrule has modified all or some of this information. USDOL/ETA has not approved,
> endorsed, or tested these modifications.

**Our modifications:** we compute occupation- and person-level exposure scores and percentiles from the task labels,
select and reorder tasks, shorten long task statements for display, and add short task names (below).

## 3. What is ours

| File | What it is |
| --- | --- |
| `occupations.json` | Built by `scripts/import-data.ts` from the files above: per occupation — title, slug, β, percentile, tasks with labels. |
| `short-task-names.json` | 3–6 word names for every task of the six launch occupations. AI-generated, then checked against the O\*NET statements; used only as display labels next to the full statement. |
| `modern-titles.json` | A small dictionary mapping modern job titles ("growth marketer") to the closest occupation, for search. Written for this project. |
| `pool/*.json` | The verified drill pool: AI-generated practice documents with planted mistakes. Every drill passes `verifyDrill`; `pool/stats.json` records how many drafts were generated, rejected and accepted, and which drills also passed the blind cross-check. Companies and people in the drills are fictional. |

## Footer text

The web app and the server-rendered pages show:

> Exposure data: Eloundou et al., “GPTs are GPTs” (2023), MIT License. This site includes information from the
> O\*NET 27.2 and 30.0 Databases by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA).
> Used under the CC BY 4.0 license. O\*NET® is a trademark of USDOL/ETA. Overrule has modified all or some of this
> information. USDOL/ETA has not approved, endorsed, or tested these modifications.
