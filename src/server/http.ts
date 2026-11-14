import type { Context } from "hono";
import { z } from "zod";
import type { ApiError } from "../shared/api";

type ErrorStatus = 400 | 402 | 403 | 404 | 409 | 429 | 500;

export function apiError(c: Context, status: ErrorStatus, error: string, message?: string): Response {
  const body: ApiError = message ? { error, message } : { error };
  return c.json(body, status);
}

/** Parse and validate a JSON body. Bodies are small; anything unparseable is a 400. */
export async function readBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, response: apiError(c, 400, "invalid_request", z.prettifyError(parsed.error)) };
}
