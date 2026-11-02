// Unit tests for charset-aware XML decoding (PLAN 2.12).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeXml,
  fetchWithTimeout,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
} from "../src/modules/librarySearch/httpUtils";

// Build bytes for `<?xml ... encoding=ENC?><a>Müller</a>` where the umlaut is a
// single ISO-8859-1 byte (0xFC) — i.e. NOT valid UTF-8.
function latin1Bytes(encodingDecl: string): ArrayBuffer {
  const prolog = `<?xml version="1.0" encoding="${encodingDecl}"?><a>M`;
  const suffix = `ller</a>`;
  const out: number[] = [];
  for (const ch of prolog) out.push(ch.charCodeAt(0));
  out.push(0xfc); // ü in ISO-8859-1
  for (const ch of suffix) out.push(ch.charCodeAt(0));
  return new Uint8Array(out).buffer;
}

function utf8Bytes(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

describe("decodeXml", () => {
  it("decodes ISO-8859-1 declared in the XML prolog (no HTTP charset)", () => {
    const text = decodeXml(latin1Bytes("ISO-8859-1"));
    expect(text).toContain("Müller");
  });

  it("honors the HTTP Content-Type charset over the prolog", () => {
    const text = decodeXml(
      latin1Bytes("UTF-8"),
      "text/xml; charset=iso-8859-1",
    );
    expect(text).toContain("Müller");
  });

  it("accepts the latin1 alias", () => {
    expect(decodeXml(latin1Bytes("latin1"))).toContain("Müller");
  });

  it("decodes UTF-8 by default when nothing is declared", () => {
    const text = decodeXml(utf8Bytes("<a>Müller</a>"));
    expect(text).toContain("Müller");
  });

  it("does NOT mojibake: naive UTF-8 decode of the latin1 bytes would differ", () => {
    const naive = new TextDecoder("utf-8").decode(latin1Bytes("ISO-8859-1"));
    expect(naive).not.toContain("Müller"); // sanity: proves the decode path matters
    expect(decodeXml(latin1Bytes("ISO-8859-1"))).toContain("Müller");
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });
  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:02 GMT", now)).toBe(2000);
  });
  it("caps long waits and clamps past dates to zero", () => {
    expect(parseRetryAfter("3600")).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:00 GMT")).toBe(0);
  });
  it("returns null for missing or junk values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("fetchWithTimeout", () => {
  const res = (status: number, headers: Record<string, string> = {}) =>
    new Response("x", { status, headers });
  let fetchStub: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchStub = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchStub.mockRestore();
  });

  it("returns a 2xx immediately", async () => {
    fetchStub.mockResolvedValueOnce(res(200));
    const r = await fetchWithTimeout("https://x.test", {}, 1000, 2, 1);
    expect(r.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx then succeeds", async () => {
    fetchStub.mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    const r = await fetchWithTimeout("https://x.test", {}, 1000, 2, 1);
    expect(r.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("retries 429 honoring Retry-After", async () => {
    fetchStub
      .mockResolvedValueOnce(res(429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(res(200));
    const r = await fetchWithTimeout("https://x.test", {}, 1000, 1, 10_000);
    // Retry-After: 0 overrides the 10s backoff, so this finishes promptly.
    expect(r.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("returns the last retryable response once retries are exhausted", async () => {
    fetchStub.mockResolvedValue(res(429));
    const r = await fetchWithTimeout("https://x.test", {}, 1000, 2, 1);
    expect(r.status).toBe(429);
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("does not retry other 4xx", async () => {
    fetchStub.mockResolvedValueOnce(res(404));
    const r = await fetchWithTimeout("https://x.test", {}, 1000, 2, 1);
    expect(r.status).toBe(404);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and rethrows the last one", async () => {
    fetchStub.mockRejectedValue(new TypeError("network down"));
    await expect(
      fetchWithTimeout("https://x.test", {}, 1000, 1, 1),
    ).rejects.toThrow("network down");
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("aborts a hung request after the timeout", async () => {
    fetchStub.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    await expect(fetchWithTimeout("https://x.test", {}, 20)).rejects.toThrow(
      "aborted",
    );
  });

  it("honors a caller abort signal and does not retry it", async () => {
    const ac = new AbortController();
    fetchStub.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const p = fetchWithTimeout(
      "https://x.test",
      { signal: ac.signal },
      10_000,
      3,
      1,
    );
    ac.abort();
    await expect(p).rejects.toThrow("aborted");
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
