import { html } from "./html";
import { renderDocument, siteFooter, siteHeader, type LayoutContext } from "./layout";

/**
 * `/film` — the 30-second film, behind the QR code in the pitch deck: watch it, then
 * go straight into the scan. The video file is a static asset (`public/film.mp4`),
 * served with byte ranges, which iOS Safari requires before it plays anything.
 */
export function renderFilmPage(context: LayoutContext): string {
  const body = html`${siteHeader()}
    <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
      <p class="eyebrow mt-6">The 30-second film</p>
      <h1 class="mt-2 text-4xl">AI does the work. You make the call.</h1>
      <video
        class="mt-6 w-full rounded-card border hairline bg-ink"
        controls
        playsinline
        preload="metadata"
        poster="/film-poster.jpg"
        src="/film.mp4"
      ></video>
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <a
          href="/scan"
          class="inline-flex min-h-12 items-center justify-center rounded-full bg-overrule px-6 font-medium text-white hover:bg-overrule-deep"
        >
          Scan my job — free
        </a>
        <span class="text-sm text-ink-3">Two minutes, no sign-up. Then catch your first AI mistake.</span>
      </div>
    </main>
    ${siteFooter()}`;

  return renderDocument(
    {
      title: "Overrule — the 30-second film",
      description: "AI does the work. You make the call. A 30-second film about the skill Overrule trains.",
      path: "/film",
    },
    body,
    context,
  );
}
