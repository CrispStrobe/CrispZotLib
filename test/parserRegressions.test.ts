// Regressions from the 2026-11 code audit: identifier casing, role-marker
// stripping, slash titles, DOI-vs-ISBN precedence, and loose source regexes.
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { parseOaiDublinCore } from "../src/modules/librarySearch/oaiRecordParser";
import {
  parseSruDublinCore,
  stripRoleMarkers,
} from "../src/modules/librarySearch/sruRecordParser";
import manifest from "../src/modules/librarySearch/endpoints.json";

const ns = manifest.namespaces as Record<string, string>;

function el(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml")
    .documentElement as unknown as Element;
}
const oaiDc = (inner: string) =>
  el(
    `<oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">${inner}</oai_dc:dc>`,
  );
const sruDc = (inner: string) =>
  el(
    `<srw_dc:dc xmlns:srw_dc="info:srw/schema/1/dc-schema" xmlns:dc="${ns.dc}">${inner}</srw_dc:dc>`,
  );

describe("stripRoleMarkers", () => {
  it.each([
    ["Smith, Fred", "Smith, Fred"],
    ["Ali, Mohammed", "Ali, Mohammed"],
    ["Smith, Ed", "Smith, Ed"],
    ["Ed Smith", "Ed Smith"],
    ["Miller, Jane (Ed.)", "Miller, Jane"],
    ["Smith, John, ed.", "Smith, John"],
    ["Doe, Jane, editor", "Doe, Jane"],
    ["Müller, K. (Hrsg.)", "Müller, K."],
    ["Kant, I. [Übers.]", "Kant, I."],
    ["Doe, J. (trans.)", "Doe, J."],
  ])("%s → %s", (input, expected) => {
    expect(stripRoleMarkers(input)).toBe(expected);
  });
});

describe("SRU Dublin Core parser", () => {
  it("keeps identifier case: URL path, ISBN/ISSN check digit X", () => {
    const rec = parseSruDublinCore(
      sruDc(
        `<dc:title>T</dc:title>
         <dc:identifier>ISBN 080442957X</dc:identifier>
         <dc:identifier>ISSN 0740-171X</dc:identifier>
         <dc:identifier>https://Example.org/Record/ABC</dc:identifier>`,
      ),
      "r1",
      undefined,
      ns,
    );
    expect(rec.isbn).toBe("080442957X");
    expect(rec.issn).toBe("0740-171X");
    expect(rec.urls).toContain("https://Example.org/Record/ABC");
  });

  it("does not truncate names ending in 'ed', and routes '(Ed.)' to editors", () => {
    const rec = parseSruDublinCore(
      sruDc(
        `<dc:title>T</dc:title>
         <dc:creator>Smith, Fred</dc:creator>
         <dc:creator>Miller, Jane (Ed.)</dc:creator>`,
      ),
      "r2",
      undefined,
      ns,
    );
    expect(rec.authors).toEqual(["Smith, Fred"]);
    expect(rec.editors).toEqual(["Miller, Jane"]);
  });

  it("doesn't read 'in' inside a word, or a bare comma, as a host item", () => {
    const rec = parseSruDublinCore(
      sruDc(
        `<dc:title>T</dc:title><dc:source>Springer Berlin, 2001</dc:source>`,
      ),
      "r3",
      undefined,
      ns,
    );
    expect(rec.series).toBeUndefined();
    expect(rec.journal_title).toBeUndefined();
  });
});

describe("OAI Dublin Core parser", () => {
  it("keeps a slash inside the title, strips the ' / Author' tail", () => {
    const a = parseOaiDublinCore(
      oaiDc(`<dc:title>TCP/IP Illustrated</dc:title>`),
      "o1",
    )!;
    expect(a.title).toBe("TCP/IP Illustrated");
    const b = parseOaiDublinCore(
      oaiDc(`<dc:title>Faust / Goethe</dc:title>`),
      "o2",
    )!;
    expect(b.title).toBe("Faust");
  });

  it("reads an ISBN-bearing Springer DOI as a DOI, not an ISBN", () => {
    const rec = parseOaiDublinCore(
      oaiDc(
        `<dc:title>Chapter</dc:title><dc:identifier>doi:10.1007/978-3-540-74958-5_25</dc:identifier>`,
      ),
      "o3",
    )!;
    expect(rec.doi).toBe("10.1007/978-3-540-74958-5_25");
    expect(rec.isbn).toBeFalsy();
  });

  it("recognises unbracketed 'ed.' on contributors", () => {
    const rec = parseOaiDublinCore(
      oaiDc(
        `<dc:title>T</dc:title><dc:contributor>Smith, John, ed.</dc:contributor>`,
      ),
      "o4",
    )!;
    expect(rec.editors).toEqual(["Smith, John"]);
  });
});
