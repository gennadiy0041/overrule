import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppContext } from "../context";
import { isAutomation, SESSION_COOKIE } from "../session";
import { collectMetrics } from "../services/metrics";
import { renderFilmPage } from "../ssr/filmPage";
import { html } from "../ssr/html";
import { renderDocument, siteFooter, siteHeader, type LayoutContext } from "../ssr/layout";
import { renderMetricsPage } from "../ssr/metricsPage";
import { renderReportPage } from "../ssr/reportPage";
import {
  relatedOccupations,
  renderRobots,
  renderSeoIndex,
  renderSeoOccupation,
  renderSitemap,
  type SeoStats,
} from "../ssr/seoPages";

const RELATED_COUNT = 6;
const SEO_CACHE = "public, max-age=3600";

function tokenMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Server-rendered pages: the SEO pages, public review reports and the metrics page. */
export function pageRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const layout: LayoutContext = { appUrl: ctx.env.APP_URL, assets: ctx.ssrAssets };
  const stats: SeoStats = { medianBeta: ctx.occupations.medianBeta, occupationCount: ctx.occupations.all.length };
  // The data is immutable for the life of the process, so each page is rendered once.
  const rendered = new Map<string, string>();
  const once = (key: string, render: () => string): string => {
    let page = rendered.get(key);
    if (page === undefined) {
      page = render();
      rendered.set(key, page);
    }
    return page;
  };

  /** Count human page views; crawlers and our own automation are not an audience. */
  const logSeoView = (c: Context, slug: string): void => {
    if (isAutomation(c.req.header("user-agent"))) return;
    ctx.events.log(getCookie(c, SESSION_COOKIE) ?? "anonymous", "seo_page_view", ctx.now(), { slug });
  };

  const notFound = (c: Context): Response =>
    c.html(
      renderDocument(
        { title: "Not found | Overrule", description: "This page does not exist.", path: c.req.path, noindex: true },
        html`${siteHeader()}
          <main class="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-5 py-24 text-center">
            <p class="eyebrow">404</p>
            <h1 class="text-3xl">Nothing to overrule here.</h1>
            <a href="/" class="font-medium underline underline-offset-4">Back to the start</a>
          </main>
          ${siteFooter()}`,
        layout,
      ),
      404,
    );

  app.get("/will-ai-replace", (c) => {
    logSeoView(c, "index");
    c.header("Cache-Control", SEO_CACHE);
    return c.html(once("index", () => renderSeoIndex(ctx.occupations.all, stats, layout)));
  });

  app.get("/will-ai-replace/:slug", (c) => {
    const occupation = ctx.occupations.getBySlug(c.req.param("slug"));
    if (!occupation) return notFound(c);
    logSeoView(c, occupation.slug);
    c.header("Cache-Control", SEO_CACHE);
    return c.html(
      once(occupation.slug, () =>
        renderSeoOccupation(
          occupation,
          relatedOccupations(occupation, ctx.occupations.all, RELATED_COUNT),
          stats,
          layout,
        ),
      ),
    );
  });

  /** The 30-second film, for the QR code in the pitch deck: watch it, then try the product. */
  app.get("/film", (c) => {
    c.header("Cache-Control", SEO_CACHE);
    return c.html(once("film", () => renderFilmPage(layout)));
  });

  app.get("/sitemap.xml", (c) => {
    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", SEO_CACHE);
    return c.body(once("sitemap", () => renderSitemap(ctx.occupations.all, ctx.env.APP_URL)));
  });

  app.get("/robots.txt", (c) => c.text(renderRobots(ctx.env.APP_URL)));

  app.get("/r/:publicId", (c) => {
    const publicId = c.req.param("publicId");
    const report = ctx.reports.find(publicId);
    return report ? c.html(renderReportPage(report, publicId, layout)) : notFound(c);
  });

  /** `/metrics?token=…` — add `&all=1` to include internal traffic, `&format=json` for raw numbers. */
  app.get("/metrics", (c) => {
    if (!tokenMatches(c.req.query("token"), ctx.env.METRICS_TOKEN)) return c.text("Unauthorized", 401);
    const snapshot = collectMetrics(ctx.db, ctx.now(), c.req.query("all") === "1", ctx.budget.limitUsd);
    c.header("Cache-Control", "no-store");
    return c.req.query("format") === "json" ? c.json(snapshot) : c.html(renderMetricsPage(snapshot, layout));
  });

  return app;
}
