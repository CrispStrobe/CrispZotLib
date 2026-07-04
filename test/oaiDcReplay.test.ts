// Record/replay tests for the OAI-PMH Dublin Core path (PLAN 7.3): parse REAL
// captured ListRecords responses through the actual production parser
// (oaiRecordParser.ts — the code OAIClient delegates to), fully offline.
// The parser is querySelectorAll/doc.evaluate-free by design, so @xmldom's
// minimal DOM is enough (same approach as sruMarcReplay.test.ts).
//
// Fixtures (captured live 2026-07-03):
//   - dnb-oai-listrecords.xml  — DNB set dnb:reiheC, 50 records with creators,
//     "Place : Publisher" strings, ISBNs with trailing junk, + resumptionToken
//   - doaj-oai-listrecords.xml — DOAJ, 29 journal records with bare ISSNs
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import {
  collectOaiRecordElements,
  findResumptionTokenElement,
  parseOaiDublinCore,
  processOaiRecordElement,
} from "../src/modules/librarySearch/oaiRecordParser";
import type { BiblioRecord } from "../src/modules/librarySearch/models";

function loadDoc(name: string): Document {
  const xml = readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf-8",
  );
  return new DOMParser().parseFromString(
    xml,
    "application/xml",
  ) as unknown as Document;
}

function replay(name: string): BiblioRecord[] {
  const doc = loadDoc(name);
  return collectOaiRecordElements(doc)
    .map((el) => processOaiRecordElement(el, "oai_dc"))
    .filter((r): r is BiblioRecord => r !== null);
}

describe("OAI DC replay: real DNB ListRecords response", () => {
  const doc = loadDoc("dnb-oai-listrecords.xml");
  const records = replay("dnb-oai-listrecords.xml");

  it("parses all 50 records (none deleted, none dropped)", () => {
    expect(collectOaiRecordElements(doc).length).toBe(50);
    expect(records.length).toBe(50);
  });

  it("extracts the resumption token and completeListSize", () => {
    const token = findResumptionTokenElement(doc);
    expect(token?.textContent).toBeTruthy();
    expect(token?.getAttribute("completeListSize")).toBe("714");
  });

  it("maps dc:creator to authors and keeps the OAI identifier as id", () => {
    const rec = records[0];
    expect(rec.id).toBe("oai:dnb.de/dnb:reiheC/1309340455");
    expect(rec.authors).toEqual(["Pharus-Plan Firma"]);
  });

  it('splits "Place : Publisher" out of dc:publisher', () => {
    const rec = records[0];
    expect(rec.place_of_publication).toBe("Berlin");
    expect(rec.publisher_name).toBe("Pharus-Plan");
  });

  it("checksum-validates the ISBN out of a noisy identifier string", () => {
    // dc:identifier is "978-3-86514-008-1 keine Bindung" — the trailing
    // binding note must not leak into the ISBN (PLAN 2.10).
    expect(records[0].isbn).toBe("9783865140081");
    expect(records[0].document_type).toBe("Book");
  });

  it("keeps year, language, subjects and format", () => {
    const rec = records[0];
    expect(rec.year).toBe("2024");
    expect(rec.language).toBe("ger");
    expect(rec.subjects).toContain("910 Geografie, Reisen");
    expect(rec.format).toBe("1 Karte");
  });

  it("never produces placeholder/junk records (PLAN 2.13)", () => {
    for (const rec of records) {
      expect(rec.title).not.toMatch(/\[DELETED RECORD\]|\[Error/);
      expect(rec.title.length).toBeGreaterThan(0);
    }
  });
});

describe("OAI DC replay: real DOAJ ListRecords response", () => {
  const doc = loadDoc("doaj-oai-listrecords.xml");
  const records = replay("doaj-oai-listrecords.xml");

  it("parses 26 of 29 records — the fixture's 3 deleted records are skipped, not imported (PLAN 2.13)", () => {
    expect(collectOaiRecordElements(doc).length).toBe(29);
    expect(records.length).toBe(26);
  });

  it("validates a bare (unprefixed) ISSN and types the record as Journal", () => {
    const rec = records[0];
    expect(rec.title).toBe("Jurnal Teknik Sipil");
    // dc:identifier "2549-2659" has no "ISSN" prefix — only the checksum
    // validation in extractIssn identifies it. First ISSN wins.
    expect(rec.issn).toBe("2549-2659");
    expect(rec.document_type).toBe("Journal");
  });

  it("collects http identifiers as URLs and years from full timestamps", () => {
    const rec = records[0];
    expect(rec.urls).toContain("https://doaj.org/toc/2549-2659");
    expect(rec.year).toBe("2017"); // from "2017-08-25T11:23:00Z"
  });
});

// Synthetic DC snippets for behaviors the captured fixtures don't exercise.
describe("parseOaiDublinCore role markers and source parsing", () => {
  function dc(inner: string): Element {
    const xml = `<oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">${inner}</oai_dc:dc>`;
    return new DOMParser().parseFromString(xml, "application/xml")
      .documentElement as unknown as Element;
  }

  it("routes bracketed roles to editors/translators (dedup across fields)", () => {
    const rec = parseOaiDublinCore(
      dc(
        `<dc:title>T</dc:title>
         <dc:creator>Weber, Klaus [Hrsg.]</dc:creator>
         <dc:creator>Neruda, Pablo [Übersetzer]</dc:creator>
         <dc:contributor>Weber, Klaus [Hrsg.]</dc:contributor>
         <dc:contributor>Lektor, Lisa [Illustrator]</dc:contributor>`,
      ),
      "t1",
    )!;
    expect(rec.editors).toEqual(["Weber, Klaus"]);
    expect(rec.translators).toEqual(["Neruda, Pablo"]);
    expect(rec.contributors).toEqual([
      { name: "Lektor, Lisa", role: "illustrator" },
    ]);
    expect(rec.authors).toEqual([]);
  });

  it("parses a journal citation out of dc:source", () => {
    const rec = parseOaiDublinCore(
      dc(
        `<dc:title>Article</dc:title>
         <dc:source>Journal of Stuff, Vol. 10, No. 2 (2023), pp. 100-110</dc:source>`,
      ),
      "t2",
    )!;
    expect(rec.journal_title).toBe("Journal of Stuff");
    expect(rec.volume).toBe("10");
    expect(rec.issue).toBe("2");
    expect(rec.pages).toBe("100-110");
    expect(rec.year).toBe("2023");
    expect(rec.document_type).toBe("Journal Article");
  });

  it("types AV/image material from dc:type (Europeana/DDB) instead of book", () => {
    const film = parseOaiDublinCore(
      dc(
        `<dc:title>Un film</dc:title>
         <dc:type>moving image</dc:type>`,
      ),
      "av1",
    )!;
    expect(film.document_type).toBe("Video");
    const sound = parseOaiDublinCore(
      dc(`<dc:title>Konzert</dc:title><dc:type>sound</dc:type>`),
      "av2",
    )!;
    expect(sound.document_type).toBe("Audio");
    // Plain text dc:type must NOT override the isbn→book inference.
    const book = parseOaiDublinCore(
      dc(
        `<dc:title>Buch</dc:title><dc:type>text</dc:type>
         <dc:identifier>ISBN 9783658310844</dc:identifier>`,
      ),
      "av3",
    )!;
    expect(book.document_type).toBe("Book");
  });

  it("returns null for deleted records via processOaiRecordElement", () => {
    const xml = `<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><ListRecords>
      <record><header status="deleted"><identifier>x</identifier></header></record>
    </ListRecords></OAI-PMH>`;
    const doc = new DOMParser().parseFromString(
      xml,
      "application/xml",
    ) as unknown as Document;
    const [el] = collectOaiRecordElements(doc);
    expect(processOaiRecordElement(el, "oai_dc")).toBeNull();
  });
});
