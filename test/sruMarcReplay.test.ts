// Record/replay test (PLAN 5.2): parse a REAL captured SRU MARCXML response
// through the actual SRUClient.parseMarcXml path, fully offline. parseMarcXml is
// doc.evaluate-free (it delegates field lookups to indexMarcRecord), so @xmldom
// plus a minimal Node shim is enough — no XPath engine required.
//
// Fixture: test/fixtures/dnb-marcxml-response.xml — live DNB SRU response for
// ISBN 9783658310844 (captured 2026-07-03).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { SRUClient } from "../src/modules/librarySearch/sruClient";

const fixture = readFileSync(
  fileURLToPath(
    new URL("./fixtures/dnb-marcxml-response.xml", import.meta.url),
  ),
  "utf-8",
);

// parseMarcXml only reads Node.ELEMENT_NODE; XPathResult is unused on this path.
const nodeShim = { ELEMENT_NODE: 1 } as unknown as typeof Node;

function parseFixture() {
  const doc = new DOMParser().parseFromString(fixture, "application/xml");
  const client = new SRUClient("https://services.dnb.de/sru/dnb");
  // The response contains exactly one MARC record; indexMarcRecord finds its
  // datafields anywhere under the element we pass.
  return (
    client as unknown as {
      parseMarcXml: (
        el: Element,
        id: string,
        raw: string | undefined,
        node: typeof Node,
        xpath: unknown,
      ) => Record<string, unknown>;
    }
  ).parseMarcXml(
    doc.documentElement as unknown as Element,
    "dnb-9783658310844",
    fixture,
    nodeShim,
    null,
  );
}

describe("parseMarcXml on a real DNB MARCXML response (PLAN 5.2)", () => {
  const rec = parseFixture();

  it("captures title + subtitle from 245$a/$b", () => {
    // DNB returns NFD-normalized text (ä = a + combining diaeresis); compare NFC.
    expect((rec.title as string).normalize("NFC")).toBe(
      "Tourismus und Nachhaltigkeit: Die Zukunftsfähigkeit des Tourismus im 21. Jahrhundert",
    );
  });

  it("captures the main author from 100$a", () => {
    expect(rec.authors).toContain("Augsbach, Gabriele");
  });

  it("captures ISBN (020$a), year (264$c) and publisher (264$b)", () => {
    expect(rec.isbn).toBe("9783658310844");
    expect(rec.year).toBe("2020");
    expect(rec.publisher_name).toBe("Springer Fachmedien Wiesbaden");
  });

  it("infers document_type Book from the leader (type 'a', level 'm')", () => {
    expect(rec.document_type).toBe("Book");
  });

  it("preserves the raw XML for re-export", () => {
    expect(rec.raw_data).toBe(fixture);
    expect(rec.schema).toBe("marcxml");
  });
});
