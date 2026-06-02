// ============================================================================
// Client-side HTTP helpers. The browser only ever talks to the server through
// the /api/* routes, so every screen and hook funnels through these functions.
//
// All helpers throw a FetchError on a non-2xx response. The thrown error's
// `message` is taken from the JSON `{ error }` envelope when present, so callers
// can surface it directly via toast().
// ============================================================================

import type { ErrorResponse } from "@/lib/types";

/** Error thrown by the fetch helpers on a non-2xx response. */
export class FetchError extends Error {
  readonly status: number;
  readonly info: unknown;

  constructor(message: string, status: number, info: unknown) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    this.info = info;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

/** Reads the response body as JSON, tolerating empty/204 responses. */
async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await parseBody(res);
  if (!res.ok) {
    const message = isErrorResponse(body)
      ? body.error
      : `Request failed with status ${res.status}`;
    throw new FetchError(message, res.status, body);
  }
  return body as T;
}

/** SWR-compatible fetcher. Parses JSON; throws FetchError on non-2xx. */
export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  return handle<T>(res);
}

async function send<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}

/** POST JSON and parse the JSON reply. Throws FetchError on non-2xx. */
export function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  return send<T>("POST", url, body);
}

/** PATCH JSON and parse the JSON reply. Throws FetchError on non-2xx. */
export function patchJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  return send<T>("PATCH", url, body);
}

/** DELETE a resource and parse the JSON reply. Throws FetchError on non-2xx. */
export function del<T = unknown>(url: string, body?: unknown): Promise<T> {
  return send<T>("DELETE", url, body);
}
