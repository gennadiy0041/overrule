import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { etDay } from "../engine/daily";
import type { AppContext, AppEnv } from "./context";
import type { Session } from "./repos/sessions";

export const SESSION_COOKIE = "ov_sid";
export const INTERNAL_COOKIE = "ov_internal";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Automated browsers (our e2e suite, link previews) must not pollute the funnel metrics. */
const AUTOMATION_UA = /playwright|headlesschrome|puppeteer|bot\b|crawler|spider/i;

function cookieOptions(ctx: AppContext) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: ctx.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_S,
  };
}

export function setSessionCookie(c: Context, ctx: AppContext, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, cookieOptions(ctx));
}

/** `/?internal=1` tags this browser as team traffic for good. */
export function internalFlag(ctx: AppContext): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.query("internal") === "1") setCookie(c, INTERNAL_COOKIE, "1", cookieOptions(ctx));
    await next();
  };
}

/**
 * Anonymous, cookie-based sessions: no sign-up, no personal data. A session row is
 * created on the first API call that needs one.
 */
export function withSession(ctx: AppContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const now = ctx.now();
    const userAgent = c.req.header("user-agent") ?? null;
    const internal = getCookie(c, INTERNAL_COOKIE) === "1" || (userAgent !== null && AUTOMATION_UA.test(userAgent));

    const cookieId = getCookie(c, SESSION_COOKIE);
    let session: Session | null = cookieId ? ctx.sessions.find(cookieId) : null;

    if (!session) {
      session = ctx.sessions.create({ id: crypto.randomUUID(), now, userAgent, isInternal: internal });
      setSessionCookie(c, ctx, session.id);
    } else {
      if (internal && !session.isInternal) {
        ctx.sessions.markInternal(session.id);
        session.isInternal = true;
      }
      // A visit on a later ET day than the previous one is a "daily return" (retention).
      if (etDay(now) > etDay(new Date(session.lastSeenAt))) {
        ctx.events.log(session.id, "daily_return", now, {
          daysSinceFirst: Math.round((now.getTime() - new Date(session.createdAt).getTime()) / 86_400_000),
        });
      }
      ctx.sessions.touch(session.id, now);
    }

    c.set("session", session);
    await next();
  };
}
