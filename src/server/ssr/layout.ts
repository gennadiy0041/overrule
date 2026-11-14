import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { html, jsonForScript, raw, type SafeHtml } from "./html";

/**
 * Server-rendered pages reuse the web app's compiled stylesheet (Tailwind scans
 * src/server/ssr via `@source` in styles.css), so they share its tokens and fonts
 * without shipping any JavaScript.
 */
export interface SsrAssets {
  css: string[];
}

interface ViteManifestEntry {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

export function loadSsrAssets(webRoot: string): SsrAssets {
  const manifestPath = join(webRoot, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) return { css: [] };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, ViteManifestEntry>;
  const entry = Object.values(manifest).find((e) => e.isEntry);
  return { css: (entry?.css ?? []).map((file) => `/${file}`) };
}

export interface PageMeta {
  title: string;
  description: string;
  /** Path of this page, e.g. "/will-ai-replace/marketing-managers". */
  path: string;
  noindex?: boolean;
  /** schema.org structured data. */
  jsonLd?: unknown;
}

export interface LayoutContext {
  appUrl: string;
  assets: SsrAssets;
}

const LOGO = raw(`<span class="inline-flex items-center gap-2">
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#14120F"/><path d="M8 16.5l5.2 5.2L24 10.5" fill="none" stroke="#FAF7F2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 23L26 9" stroke="#D93A2B" stroke-width="3" stroke-linecap="round"/></svg>
  <span class="font-serif text-[1.35rem] leading-none font-medium tracking-tight">overrule</span>
</span>`);

export function siteHeader(right?: SafeHtml): SafeHtml {
  return html`<header class="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
    <a href="/" aria-label="Overrule — home" class="rounded-md">${LOGO}</a>
    <div class="flex items-center gap-4 text-sm text-ink-2">${right}</div>
  </header>`;
}

export function siteFooter(): SafeHtml {
  return html`<footer class="border-t hairline">
    <div class="mx-auto w-full max-w-3xl px-5 py-8 text-[0.8rem] leading-relaxed text-ink-3">
      <nav class="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-ink-2">
        <a href="/about" class="underline-offset-4 hover:underline">About &amp; method</a>
        <a href="/will-ai-replace" class="underline-offset-4 hover:underline">AI exposure by job</a>
        <a href="/survey" class="underline-offset-4 hover:underline">2-minute survey</a>
        <a href="https://github.com/gennadiy0041/overrule" class="underline-offset-4 hover:underline" rel="noreferrer">GitHub</a>
      </nav>
      <p>
        Exposure data: Eloundou et al., “GPTs are GPTs” (2023), dataset under the MIT License. Task statements from the
        O*NET® Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under
        the CC BY 4.0 license. Overrule has modified this information; USDOL/ETA has not approved, endorsed, or tested
        these modifications.
      </p>
      <p class="mt-2">Exposure means AI can speed up a task — not that a job disappears.</p>
    </div>
  </footer>`;
}

/** A complete HTML document around `body`. */
export function renderDocument(meta: PageMeta, body: SafeHtml, context: LayoutContext): string {
  const url = `${context.appUrl}${meta.path}`;
  const page = html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${meta.title}</title>
    <meta name="description" content="${meta.description}" />
    ${meta.noindex ? raw('<meta name="robots" content="noindex, nofollow" />') : html`<link rel="canonical" href="${url}" />`}
    <meta name="theme-color" content="#FAF7F2" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Overrule" />
    <meta property="og:title" content="${meta.title}" />
    <meta property="og:description" content="${meta.description}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${context.appUrl}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    ${context.assets.css.map((href) => html`<link rel="stylesheet" href="${href}" />`)}
    ${meta.jsonLd ? html`<script type="application/ld+json">${jsonForScript(meta.jsonLd)}</script>` : ""}
  </head>
  <body>
    <div class="flex min-h-dvh flex-col">${body}</div>
  </body>
</html>`;
  return page.value;
}
