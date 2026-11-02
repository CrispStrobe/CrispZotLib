// src/modules/librarySearch/httpUtils.ts
//
// Shared HTTP helper for the library-search clients. Every outgoing request
// gets an AbortController-based timeout (bare `fetch` has none, so a hung
// catalog server would otherwise stall a search indefinitely) plus an optional
// retry/backoff for transient network errors, 5xx and 429 responses.

/** Map common charset aliases to labels the Encoding Standard / TextDecoder accepts. */
function normalizeCharset(cs: string | undefined): string {
  if (!cs) return "utf-8";
  const c = cs.trim().toLowerCase().replace(/["']/g, "");
  if (c === "latin1" || c === "latin-1" || c === "iso8859-1")
    return "iso-8859-1";
  if (c === "utf8") return "utf-8";
  return c;
}

/**
 * Decode an XML response body honoring its declared charset (PLAN 2.12).
 *
 * `Response.text()` decodes as UTF-8 whenever the HTTP layer doesn't specify a
 * charset — but several catalogs (notably DNB) serve ISO-8859-1 declared only
 * in the XML prolog, which turns umlauts into mojibake. This prefers the HTTP
 * `Content-Type` charset, then sniffs the `<?xml … encoding="…"?>` declaration,
 * and falls back to UTF-8.
 *
 * @param buffer       Raw response bytes.
 * @param contentType  The response `Content-Type` header, if any.
 */
export function decodeXml(
  buffer: ArrayBuffer,
  contentType?: string | null,
): string {
  const bytes = new Uint8Array(buffer);
  let charset = contentType?.match(/charset=([^;]+)/i)?.[1];
  if (!charset) {
    // Sniff the XML declaration. ISO-8859-1 maps every byte to a char, so it is
    // safe for reading the ASCII prolog regardless of the real encoding.
    const head = new TextDecoder("iso-8859-1").decode(bytes.subarray(0, 256));
    charset = head.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1];
  }
  const label = normalizeCharset(charset);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Read a response body as XML text, honoring its declared charset (see decodeXml). */
export async function readXml(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  return decodeXml(buffer, response.headers?.get?.("content-type"));
}

/** Sleep helper built on the sandbox's setTimeout. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Upper bound on a server-requested Retry-After wait, so a search never stalls. */
export const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Parse a `Retry-After` header (delta-seconds or an HTTP-date) into a wait in
 * milliseconds, capped at `MAX_RETRY_AFTER_MS`. Returns `null` when the header
 * is absent or unparseable so the caller falls back to exponential backoff.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const v = value.trim();
  let ms: number;
  if (/^\d+$/.test(v)) {
    ms = Number(v) * 1000;
  } else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** 5xx and 429 (rate limited) are transient; other 4xx are the caller's to interpret. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * fetch() with a timeout and optional retry/backoff.
 *
 * @param url        Request URL.
 * @param init       Standard fetch init (headers, method, …). A caller-supplied
 *                   `signal` is honored alongside the timeout.
 * @param timeoutMs  Per-attempt timeout. Default 30s.
 * @param retries    Additional attempts on a *transient* failure (network
 *                   error, timeout, 5xx, or 429). Default 0 (single attempt).
 * @param retryDelayMs Base backoff; doubles each retry. Default 500ms. A
 *                   server `Retry-After` header (capped) takes precedence.
 *
 * Other 4xx responses are returned as-is (not transient — the caller decides).
 * Once retries are exhausted the final response is returned (so callers can
 * report its status) or the final network error is thrown.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000,
  retries = 0,
  retryDelayMs = 500,
): Promise<Response> {
  const outer = init.signal;

  for (let attempt = 0; ; attempt++) {
    if (outer?.aborted) throw outer.reason ?? new Error("Aborted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // AbortSignal.any() is not available in every Zotero 7 runtime; link by hand.
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener?.("abort", onOuterAbort, { once: true });

    let waitMs = retryDelayMs * Math.pow(2, attempt);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!isRetryableStatus(response.status) || attempt >= retries) {
        return response;
      }
      waitMs =
        parseRetryAfter(response.headers?.get?.("retry-after")) ?? waitMs;
      // Release the connection held by the discarded body.
      response.body?.cancel?.().catch(() => {});
    } catch (e) {
      // Network failure, timeout, or caller abort. Retry only the former two.
      if (attempt >= retries || outer?.aborted) throw e;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener?.("abort", onOuterAbort);
    }
    await delay(waitMs);
  }
}
