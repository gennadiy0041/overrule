/**
 * The stage deck as a PowerPoint file, with the 30-second film embedded and playing by itself.
 *
 *   bun run build-deck     (first: writes deck/pitch.html, the stage version of the deck)
 *   bun run build-pptx     → deck/Overrule_BusinessCup2.pptx
 *
 * How it is built, and why:
 * - Every slide is a picture of the HTML deck at twice its size (2560 × 1440). The deck is set in
 *   Fraunces and Geist; a computer at the venue will not have them, and PowerPoint would swap the
 *   fonts and break the layout. Pictures look the same everywhere. The cost: the text is not
 *   editable in PowerPoint — the deck is edited in scripts/build-deck.ts and rebuilt.
 * - The film slide is a black slide with the video filling it. The film is stored inside the file,
 *   starts when the slide opens, and a click on it pauses or resumes. Its subtitle track is left
 *   out, so no player shows captions on its own.
 * - Links of the HTML deck become invisible clickable areas in the same places.
 * - Speaker notes carry the spoken text of the five-minute pitch (docs/pitch-script-ru.md).
 * - PowerPoint itself assembles the file (scripts/build-pptx.ps1, through COM): the video is stored
 *   exactly the way PowerPoint stores one inserted by hand. Needs Windows with PowerPoint, and ffmpeg.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dir, "..");
const DECK = join(ROOT, "deck");
/**
 * `--light` embeds the web-sized film (9 MB) instead of the full-quality one (37 MB): a 12 MB file
 * that fits mail and upload limits. The stage file keeps the full-quality film.
 */
const LIGHT = process.argv.includes("--light");
const WORK = join(DECK, "out", LIGHT ? "pptx-light" : "pptx");
const OUTPUT = join(DECK, LIGHT ? "Overrule_BusinessCup2-light.pptx" : "Overrule_BusinessCup2.pptx");
const SLIDE = { width: 1280, height: 720 };

/** What the presenter needs to know on the film slide; shown in Presenter View only. */
const FILM_HINT =
  "Фильм запускается сам, как только открывается слайд: 30 секунд, со звуком. " +
  "Клик по видео — пауза и продолжение. Стрелка вправо — следующий слайд.\n\n" +
  "Если вверху жёлтая полоса «Защищённый просмотр», до показа нажми «Разрешить редактирование»: " +
  "без этого PowerPoint видео не проигрывает.\n\n" +
  "Запасной вариант: файл film-full.mp4 из той же папки или overrule-production.up.railway.app/film.";

interface LinkArea {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SlideEntry {
  number: number;
  film: boolean;
  image?: string;
  alt: string;
  notes: string;
  links: LinkArea[];
}

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command[0]} exited with ${result.exitCode}`);
}

/** The spoken text of each slide: the quoted lines under "### Слайд N" in the five-minute version. */
function spokenNotes(): Map<number, string> {
  const script = readFileSync(join(ROOT, "docs", "pitch-script-ru.md"), "utf8");
  const fiveMinutes = script.split(/^## /m).find((part) => part.startsWith("Версия на 5 минут")) ?? "";
  const notes = new Map<number, string>();
  for (const section of fiveMinutes.split(/^### /m).slice(1)) {
    const number = Number(/^Слайд (\d+)/.exec(section)?.[1]);
    if (!number) continue;
    const heading = section.split("\n", 1)[0]!.trim();
    const spoken = section
      .split("\n")
      .filter((line) => line.startsWith(">"))
      .map((line) => line.replace(/^>\s?/, "").trim())
      .join("\n")
      // A blank quoted line is a pause between paragraphs; a soft-wrapped line continues the sentence.
      .replace(/\n{2,}/g, "\u0000")
      .replace(/\n/g, " ")
      .replace(/\u0000/g, "\n\n")
      // Markdown emphasis and code marks mean nothing in PowerPoint's notes: keep the words, drop the marks.
      .replace(/(\*\*|\*|`)/g, "")
      .trim();
    notes.set(number, [heading, spoken].filter(Boolean).join("\n\n"));
  }
  return notes;
}

mkdirSync(WORK, { recursive: true });
const pitch = join(DECK, "pitch.html");
if (!existsSync(pitch)) throw new Error("deck/pitch.html is missing: run `bun run build-deck` first");

// The film without its subtitle track, and its first frame as the picture shown before it starts.
const webFilm = join(ROOT, "public", "film.mp4");
const source = (LIGHT ? [webFilm] : [join(DECK, "film-full.mp4"), webFilm]).find((path) => existsSync(path));
if (!source) throw new Error("No film found: expected deck/film-full.mp4 or public/film.mp4");
const film = join(WORK, "film.mp4");
const poster = join(WORK, "poster.png");
run(["ffmpeg", "-v", "error", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart", film]);
run(["ffmpeg", "-v", "error", "-y", "-i", film, "-frames:v", "1", poster]);

// One picture per slide of the stage deck, and where its links are.
const notes = spokenNotes();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: SLIDE, deviceScaleFactor: 2 });
const slides: SlideEntry[] = [];
try {
  const url = pathToFileURL(pitch).href;
  await page.goto(url, { waitUntil: "load" });
  const count = await page.locator("#stage .slide").count();
  for (let number = 1; number <= count; number++) {
    // The stage deck reads the slide number from the hash when it loads.
    await page.goto(`${url}?slide=${number}#${number}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const active = page.locator("#stage .slide.active");
    const isFilm = (await active.locator("video").count()) > 0;
    const facts = await active.evaluate((slide) => {
      const frame = slide.getBoundingClientRect();
      const links = [...slide.querySelectorAll("a[href]")].flatMap((anchor) => {
        // An inline link around a block (the QR tile) has no box of its own: take everything inside it.
        const boxes = [anchor, ...anchor.querySelectorAll("*")]
          .flatMap((element) => [...element.getClientRects()])
          .filter((box) => box.width > 0 && box.height > 0);
        if (boxes.length === 0) return [];
        const left = Math.min(...boxes.map((box) => box.left));
        const top = Math.min(...boxes.map((box) => box.top));
        const right = Math.max(...boxes.map((box) => box.right));
        const bottom = Math.max(...boxes.map((box) => box.bottom));
        return [{ href: (anchor as HTMLAnchorElement).href, x: left - frame.left, y: top - frame.top, w: right - left, h: bottom - top }];
      });
      const title = slide.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const text = (slide as HTMLElement).innerText.replace(/\s+/g, " ").trim();
      return { links, title, text };
    });

    const entry: SlideEntry = {
      number,
      film: isFilm,
      // Alternative text: what the slide says, for screen readers and for search inside the file.
      alt: isFilm ? "Overrule — the 30-second film" : (facts.text || facts.title || `Slide ${number}`).slice(0, 2_000),
      notes: [notes.get(number) ?? "", isFilm ? FILM_HINT : ""].filter(Boolean).join("\n\n"),
      links: isFilm ? [] : facts.links.filter((link) => /^https?:/.test(link.href)),
    };
    if (!isFilm) {
      entry.image = join(WORK, `slide-${String(number).padStart(2, "0")}.png`);
      await page.screenshot({ path: entry.image, clip: { x: 0, y: 0, ...SLIDE } });
    }
    slides.push(entry);
  }
} finally {
  await browser.close();
}
if (slides.length > 10) throw new Error("The deck must not exceed 10 slides");
if (slides.filter((slide) => slide.film).length !== 1) throw new Error("Expected exactly one film slide in deck/pitch.html");

const manifest = join(WORK, "manifest.json");
writeFileSync(
  manifest,
  JSON.stringify(
    { title: "Overrule — Business Cup 2.0", author: "Gennady Kozlov", width: SLIDE.width, height: SLIDE.height, film, poster, output: OUTPUT, slides },
    null,
    2,
  ),
);

run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "build-pptx.ps1"), "-Manifest", manifest]);
const megabytes = (Bun.file(OUTPUT).size / 1_048_576).toFixed(1);
console.log(`pptx: ${slides.length} slides, film on slide ${slides.find((slide) => slide.film)!.number}, ${megabytes} MB → ${OUTPUT}`);
