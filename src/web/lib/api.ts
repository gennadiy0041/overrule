import { useCallback, useEffect, useState } from "react";
import type { ApiError, ClientEvent } from "../../shared/api";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiClientError(response.status, payload?.error ?? "request_failed", payload?.message);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
};

/** Fire-and-forget funnel event. Never throws: analytics must not break the product. */
export function track(name: ClientEvent, props?: Record<string, string | number | boolean>): void {
  void fetch("/api/events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, props }),
  }).catch(() => undefined);
}

export interface Loadable<T> {
  data: T | undefined;
  error: ApiClientError | undefined;
  loading: boolean;
  reload: () => void;
}

/** GET a JSON resource for the lifetime of a component. Pass `null` to skip. */
export function useApi<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiClientError; loading: boolean }>({
    loading: path !== null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    api
      .get<T>(path)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const error = cause instanceof ApiClientError ? cause : new ApiClientError(0, "network_error");
        setState({ error, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
