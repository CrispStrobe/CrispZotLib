// Record/replay tests for the SRU Dublin Core and RDFxml parse paths (PLAN 7.4
// / the deferred half of 5.2). These were the last parse paths with zero offline
// coverage: the old code walked them with doc.evaluate + a prefixed XPath dialect
// that @xmldom cannot run. sruRecordParser.ts reproduces the same semantics with
// namespace-aware DOM walking, so the real production parser now runs fully
// offline against REAL captured responses.
//
// Fixtures (captured live 2026-07-04):
//   - bnf-dublincore-response.xml — BnF SRU `bib.title any "Python"`, 5 dc records
//   - dnb-rdfxml-response.xml      — DNB SRU `TIT=Python` RDFxml, 5 records
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import {
  collectSruRecordDataElements,
  parseSruDublinCore,
  parseSruRdfXml,
} from "../src/modules/librarySearch/sruRecordParser";
import manifest from "../src/modules/librarySearch/endpoints.json";
import type { BiblioRecord } from "../src/modules/librarySearch/models";

const ns = manifest.namespaces as Record<string, string>;

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

function parseWith(
  name: string,
  fn: (el: Element, id: string) => BiblioRecord,
): BiblioRecord[] {
  const doc = loadDoc(name);
  return collectSruRecordDataElements(doc).map((el, i) => fn(el, `r-${i}`));
}

describe("SRU Dublin Core replay: real BnF response", () => {
  const records = parseWith("bnf-dublincore-response.xml", (el, id) =>
    parseSruDublinCore(el, id, undefined, ns),
  );

  it("parses all 5 records", () => {
    expect(records.length).toBe(5);
  });

  it("strips the French role phrase off dc:creator (cleanPersonName)", () => {
    // dc:creator is "Ziadé, Tarek. Auteur du texte"
    expect(records[0].authors).toEqual(["Ziadé, Tarek"]);
  });

  it("routes a dc:contributor to contributors with its role", () => {
    // dc:contributor "Tonnerre, Patrick. Collaborateur"
    expect(records[0].contributors).toEqual([
      { name: "Tonnerre, Patrick", role: "contributor" },
    ]);
  });

  it("extracts the ISBN from the 'ISBN 2212116772' identifier, not the EAN", () => {
    // Two dc:identifier values plus an EAN in dc:description; only the ISBN one wins.
    expect(records[0].isbn).toBe("2212116772");
    expect(records[0].abstract).toContain("EAN 9782212116779");
  });

  it("captures year, publisher, language and infers Book from the ISBN", () => {
    expect(records[0].year).toBe("2006");
    expect(records[0].publisher_name).toBe("Eyrolles (Paris)");
    expect(records[0].language).toBe("fre");
    expect(records[0].document_type).toBe("Book");
  });

  it("keeps the dc:subject and the http dc:identifier as a URL", () => {
    expect(records[0].subjects).toContain("Python (langage de programmation)");
    expect(records[0].urls).toContain(
      "http://catalogue.bnf.fr/ark:/12148/cb40110369n",
    );
  });

  it("takes the first dc:title when several languages are present", () => {
    // Record 2 has a French then an English dc:title; the French one wins.
    expect(records[1].title).toContain("L'oeil du python");
  });

  it("cleans a 'dir. de publ.' statement down to the name", () => {
    expect(records[3].authors).toEqual(["Fénat, Karine"]);
  });
});

describe("SRU RDFxml replay: real DNB response", () => {
  const records = parseWith("dnb-rdfxml-response.xml", (el, id) =>
    parseSruRdfXml(el, id, undefined, ns),
  );

  it("parses all 5 records", () => {
    expect(records.length).toBe(5);
  });

  it("joins dc:title with the rdau:P60493 subtitle", () => {
    // DNB returns NFD-normalized text (ü = u + combining diaeresis); compare NFC.
    expect(records[0].title.normalize("NFC")).toBe(
      "Computational Physics: Numerische Methoden und computergestützte Verfahren mit Python",
    );
  });

  it("splits the rdau:P60327 statement of responsibility into authors", () => {
    expect(records[0].authors.map((a) => a.normalize("NFC"))).toEqual([
      "Jörg Bünemann",
      "Jan Kierfeld",
    ]);
  });

  it("reads bibo:isbn13 (hyphens stripped), place, edition, language", () => {
    expect(records[0].isbn).toBe("9783527414284");
    expect(records[0].place_of_publication).toBe("Weinheim");
    expect(records[0].edition).toBe("1. Auflage");
    expect(records[0].language).toBe("ger");
  });

  it("derives pages from the isbd:P1053 extent and year from dcterms:issued", () => {
    expect(records[0].extent).toBe("350 Seiten");
    expect(records[0].pages).toBe("350");
    expect(records[0].year).toBe("2030");
  });

  it("infers Book from rdf:type Document + an ISBN, but leaves ISBN-less Documents alone", () => {
    expect(records[0].document_type).toBe("Book");
    // Record 5 is an rdf:type Document with no ISBN → stays "Document".
    expect(records[4].document_type).toBe("Document");
    expect(records[4].isbn).toBeUndefined();
  });

  it("collects the foaf:primaryTopic / umbel:isLike / rdau:P60372 URLs in order", () => {
    expect(records[1].urls).toEqual([
      "https://deposit.dnb.de/cgi-bin/dokserv?id=5d83f9b2d9624941adecf0e85b886f28",
      "http://www.wiley-vch.de",
      "http://www.wiley-vch.de/ISBN978-3-527-72497-0",
    ]);
  });
});

// The fixtures only carry rdf:type (no dcterms:type/dc:type) and Thema subjects
// (not GND/DDC), so this synthetic record locks in the two namespace-collision
// behaviours the refactor had to preserve: type resolves dcterms → dc → rdf by
// PRIORITY (not document order), and dcterms:subject (GND) vs dc:subject (DDC)
// are handled by their distinct namespaces despite sharing the localName.
describe("SRU RDFxml namespace-aware priority (synthetic)", () => {
  const xml = `<?xml version="1.0"?>
<srw:recordData xmlns:srw="http://www.loc.gov/zing/srw/">
  <rdf:RDF
      xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:dcterms="http://purl.org/dc/terms/">
    <rdf:Description rdf:about="urn:x">
      <rdf:type rdf:resource="http://purl.org/ontology/bibo/Document"/>
      <dcterms:type>Winning Type</dcterms:type>
      <dc:title>T</dc:title>
      <dcterms:subject rdf:resource="https://d-nb.info/gnd/4321"/>
      <dc:subject rdf:datatype="https://d-nb.info/standards/elementset/dnb#ddc-subject-category">004</dc:subject>
    </rdf:Description>
  </rdf:RDF>
</srw:recordData>`;
  const el = new DOMParser().parseFromString(xml, "application/xml")
    .documentElement as unknown as Element;
  const rec = parseSruRdfXml(el, "syn", undefined, ns);

  it("resolves dcterms:type over rdf:type even though rdf:type comes first", () => {
    expect(rec.document_type).toBe("Winning Type");
  });

  it("keeps the GND id (dcterms:subject) and the DDC code (dc:subject) apart", () => {
    expect(rec.subjects).toContain("4321");
    expect(rec.subjects).toContain("DDC:004");
  });
});
