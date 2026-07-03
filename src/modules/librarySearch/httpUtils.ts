// src/modules/librarySearch/httpUtils.ts
//
// Shared HTTP helper for the library-search clients. Every outgoing request
// gets an AbortController-based timeout (bare `fetch` has none, so a hung
// catalog server would otherwise stall a search indefinitely) plus an optional
// retry/backoff for transient network errors and 5xx responses.

/** Sleep helper built on the sandbox's setTimeout. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() with a timeout and optional retry/backoff.
 *
 * @param url        Request URL.
 * @param init       Standard fetch init (headers, method, …).
 * @param timeoutMs  Per-attempt timeout. Default 30s.
 * @param retries    Additional attempts on a *transient* failure (network
 *                   error, timeout, or 5xx). Default 0 (single attempt).
 * @param retryDelayMs Base backoff; doubles each retry. Default 500ms.
 *
 * A 4xx response is returned as-is (not a transient failure — the caller
 * decides). The final response/error is surfaced once retries are exhausted.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000,
  retries = 0,
  retryDelayMs = 500,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      // Retry on server-side errors; 4xx is the caller's to interpret.
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      } else {
        return response;
      }
    } catch (e) {
      // Network failure or timeout abort. Retry if attempts remain.
      lastError = e;
      if (attempt >= retries) throw e;
    } finally {
      clearTimeout(timer);
    }
    // Exponential backoff before the next attempt.
    await delay(retryDelayMs * Math.pow(2, attempt));
  }

  // Only reached when the last attempt was a retryable 5xx.
  throw lastError instanceof Error
    ? lastError
    : new Error(`Request to ${url} failed after ${retries + 1} attempts`);
}
