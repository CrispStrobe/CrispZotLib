// Live endpoint health probe (PLAN 7.2). Skipped unless LIVE_PROBE=1 — the
// normal offline suite must never hit the network. Run by the weekly
// endpoint-health GitHub Actions cron (and on demand):
//
//   LIVE_PROBE=1 npx vitest run test/live/endpointHealth.test.ts
//
// What it checks, per endpoints.json (the shared cross-repo manifest):
//   - SRU: replays each endpoint's own `examples.title` query verbatim and
//     requires numberOfRecords > 0 (the examples were chosen to always hit).
//   - OAI: Identify must answer, and ListMetadataFormats must still offer the
//     endpoint's defaultMetadataPrefix (this catches the Crossref-style rot
//     where the host lives on but stops serving the format we parse).
//   - IxTheo: solves the real proof-of-work challenge via the plugin's own
//     solveIxTheoPow and requires a search to return result markers — a canary
//     for the anti-bot wall changing again (PLAN 4.2 broke all three repos).
import { describe, expect, it } from "vitest";
import {
  IXTHEO_ENDPOINTS,
  OAI_ENDPOINTS,
  SRU_ENDPOINTS,
} from "../../src/modules/librarySearch/endpoints";
import { solveIxTheoPow } from "../../src/modules/librarySearch/ixtheoPow";

const LIVE = !!process.env.LIVE_PROBE;

// Some catalogs reject bare bot UAs; identify like a browser, as Zotero does.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
};

async function fetchText(url: string, timeoutMs: number, cookie?: string) {
  // One retry after a short pause: a transient ECONNRESET/timeout must not
  // page anyone — only reproducible failures should.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: cookie ? { ...HEADERS, Cookie: cookie } : HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      const text = await res.text();
      return { res, text };
    } catch (e) {
      if (attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

describe.runIf(LIVE)("SRU endpoint health (live)", () => {
  for (const [id, ep] of Object.entries(SRU_ENDPOINTS)) {
    it(`${id}: title example query returns hits`, async () => {
      const params = new URLSearchParams({
        operation: "searchRetrieve",
        version: ep.version ?? "1.1",
        query: String(ep.examples?.title),
        maximumRecords: "1",
      });
      for (const [k, v] of Object.entries(ep.queryParams ?? {})) {
        params.set(k, v);
      }
      const { res, text } = await fetchText(
        `${ep.url}?${params.toString()}`,
        40_000,
      );
      expect(res.ok, `${id}: HTTP ${res.status}`).toBe(true);
      const m = text.match(/numberOfRecords[^>]*>\s*(\d+)/);
      expect(
        m,
        `${id}: no numberOfRecords in response: ${text.slice(0, 400)}`,
      ).toBeTruthy();
      expect(
        Number(m![1]),
        `${id}: 0 hits for '${ep.examples?.title}'`,
      ).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe.runIf(LIVE)("OAI-PMH endpoint health (live)", () => {
  for (const [id, ep] of Object.entries(OAI_ENDPOINTS)) {
    it(`${id}: Identify answers and default metadata prefix is offered`, async () => {
      const { res, text } = await fetchText(`${ep.url}?verb=Identify`, 60_000);
      expect(res.ok, `${id}: HTTP ${res.status}`).toBe(true);
      expect(
        /<(\w+:)?Identify[\s>]/.test(text),
        `${id}: no <Identify> in response: ${text.slice(0, 400)}`,
      ).toBe(true);

      const prefix = ep.defaultMetadataPrefix || "oai_dc";
      const { res: res2, text: formats } = await fetchText(
        `${ep.url}?verb=ListMetadataFormats`,
        60_000,
      );
      expect(res2.ok, `${id}: ListMetadataFormats HTTP ${res2.status}`).toBe(
        true,
      );
      expect(
        formats.includes(`<metadataPrefix>${prefix}</metadataPrefix>`) ||
          formats.includes(prefix),
        `${id}: '${prefix}' no longer offered: ${formats.slice(0, 400)}`,
      ).toBe(true);
    }, 130_000);
  }
});

describe.runIf(LIVE)("IxTheo proof-of-work canary (live)", () => {
  it("solves the PoW wall and a search returns result markers", async () => {
    const ep = Object.values(IXTHEO_ENDPOINTS)[0];
    const pow = await solveIxTheoPow(globalThis.crypto, Date.now());
    const url = `${ep.baseUrl}/Search/Results?${new URLSearchParams({
      lookfor: "Habermas",
      type: "AllFields",
    })}`;
    const { res, text } = await fetchText(
      url,
      60_000,
      `pow_token=${pow.token}`,
    );
    expect(res.ok, `HTTP ${res.status}`).toBe(true);
    expect(
      /record-list|hiddenId/.test(text),
      `no result markers — PoW wall likely changed again (PLAN 4.2). ` +
        `Body starts: ${text.slice(0, 400)}`,
    ).toBe(true);
  }, 180_000);
});
