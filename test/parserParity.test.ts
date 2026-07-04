// Cross-repo SRU parser parity guard (PLAN 7.4 / audit #2a) — CrispZotLib side.
//
// test/fixtures/parity/parser-records.json is the CANONICAL copy of the shared
// parser golden (raw MARCXML/Dublin-Core + agreed parsed-field output), synced
// to CrispLib (test_parser_parity.py) and citer (tests/parser_parity_test.py)
// by scripts/sync-endpoints.sh. This asserts the Dublin-Core cases here through
// the real pure parser (parseSruDublinCore), so the canonical repo validates the
// golden it hosts. The MARCXML path is covered by sruMarcReplay/sruDcRdfReplay;
// the three-way DC check catches TS↔Python drift on the shared golden.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { parseSruDublinCore } from "../src/modules/librarySearch/sruRecordParser";
import manifest from "../src/modules/librarySearch/endpoints.json";

const ns = manifest.namespaces as Record<string, string>;

interface ParserCase {
  name: string;
  schema: string;
  xml: string;
  expected: Record<string, unknown>;
}

const cases: ParserCase[] = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/parity/parser-records.json", import.meta.url),
    ),
    "utf-8",
  ),
);

const dcCases = cases.filter((c) => c.schema === "dublincore");

describe("SRU parser parity: Dublin Core golden (shared with CrispLib + citer)", () => {
  it("has at least one Dublin Core case to check", () => {
    expect(dcCases.length).toBeGreaterThan(0);
  });

  for (const c of dcCases) {
    it(`matches the golden for ${c.name}`, () => {
      const el = new DOMParser().parseFromString(c.xml, "application/xml")
        .documentElement as unknown as Element;
      const rec = parseSruDublinCore(
        el,
        c.name,
        undefined,
        ns,
      ) as unknown as Record<string, unknown>;
      for (const [field, expected] of Object.entries(c.expected)) {
        expect(rec[field], `${c.name}.${field}`).toEqual(expected);
      }
    });
  }
});
