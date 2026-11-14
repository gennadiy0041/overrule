import type { ApiError } from "../../shared/api";

export interface ServerEvent {
  event: string;
  data: unknown;
}

/** Parse complete SSE frames out of `buffer`; returns the events and the unfinished remainder. */
export function parseFrames(buffer: string): { events: ServerEvent[]; rest: string } {
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  const events: ServerEvent[] = [];
  for (const frame of frames) {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) as unknown });
    } catch {
      // A frame we cannot parse carries nothing we can act on.
    }
  }
  return { events, rest };
}

/**
 * POST a JSON body and read the response as server-sent events. (`EventSource`
 * can only GET.) A non-2xx JSON error is delivered as a single "failed" event,
 * so callers handle one shape.
 */
export async function postEvents(
  path: string,
  body: unknown,
  onEvent: (event: ServerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    onEvent({ event: "failed", data: { error: payload?.error ?? "request_failed" } });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseFrames(buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
  parseFrames(`${buffer}\n\n`).events.forEach(onEvent);
}
