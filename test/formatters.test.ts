// Unit tests for the pure formatting functions in librarySearch/formatters.ts
// These run fully offline (no Zotero globals, no network, no DOM).
import { describe, it, expect } from "vitest";
import {
  generateCitationKey,
  formatRecordBibtex,
  formatRecordRis,
  formatRecord,
  parseCreatorName,
} from "../src/modules/librarySearch/formatters";
import { BiblioRecord } from "../src/modules/librarySearch/models";

// Minimal record factory so tests only specify the fields they care about.
function rec(partial: Partial<BiblioRecord>): BiblioRecord {
  return {
    id: "test-1",
    title: "Untitled",
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
    ...partial,
  };
}

describe("generateCitationKey", () => {
  it("uses first author last name + year", () => {
    expect(
      generateCitationKey(rec({ authors: ["Guido van Rossum"], year: "2020" })),
    ).toBe("rossum2020");
  });

  it('handles "Last, First" form', () => {
    expect(
      generateCitationKey(rec({ authors: ["Einstein, Albert"], year: "1905" })),
    ).toBe("einstein1905");
  });

  it("falls back to editor when no authors", () => {
    expect(
      generateCitationKey(rec({ editors: ["Knuth, Donald"], year: "1968" })),
    ).toBe("knuth1968");
  });

  it('returns "unknown" when nothing is available', () => {
    expect(generateCitationKey(rec({}))).toBe("unknown");
  });
});

describe("parseCreatorName", () => {
  it('splits "Last, First"', () => {
    expect(parseCreatorName("Einstein, Albert")).toEqual({
      lastName: "Einstein",
      firstName: "Albert",
    });
  });

  it('splits "First Last"', () => {
    expect(parseCreatorName("Guido van Rossum")).toEqual({
      lastName: "Rossum",
      firstName: "Guido van",
    });
  });

  it('keeps corporate names single-field (no "Nations, United")', () => {
    expect(parseCreatorName("United Nations")).toEqual({
      name: "United Nations",
      fieldMode: 1,
    });
    expect(parseCreatorName("Deutsche Nationalbibliothek")).toEqual({
      name: "Deutsche Nationalbibliothek",
      fieldMode: 1,
    });
    expect(parseCreatorName("World Health Organization")).toMatchObject({
      fieldMode: 1,
    });
  });

  it("keeps a single-token mononym single-field", () => {
    expect(parseCreatorName("Aristotle")).toEqual({
      name: "Aristotle",
      fieldMode: 1,
    });
  });
});

describe("formatRecordBibtex", () => {
  it('emits @book by default and joins authors with " and "', () => {
    const out = formatRecordBibtex(
      rec({ title: "A Book", authors: ["A. One", "B. Two"] }),
    );
    expect(out).toMatch(/^@book\{/);
    expect(out).toContain("author = {A. One and B. Two}");
    expect(out).toContain("title = {A Book}");
  });

  it("maps document_type to the correct BibTeX entry type", () => {
    expect(
      formatRecordBibtex(rec({ document_type: "Journal Article" })),
    ).toMatch(/^@article\{/);
    expect(formatRecordBibtex(rec({ document_type: "Book Chapter" }))).toMatch(
      /^@incollection\{/,
    );
    expect(formatRecordBibtex(rec({ document_type: "Thesis" }))).toMatch(
      /^@phdthesis\{/,
    );
  });

  it("escapes BibTeX-special characters in the title", () => {
    const out = formatRecordBibtex(rec({ title: "Cost & Value_100%" }));
    expect(out).toContain("title = {Cost \\& Value\\_100\\%}");
  });

  // Fixed (audit finding): all prose fields are now BibTeX-escaped, not just the title.
  it("escapes special characters in non-title prose fields", () => {
    const out = formatRecordBibtex(
      rec({ title: "X", publisher_name: "Marx & Engels", series: "Vol_1" }),
    );
    expect(out).toContain("publisher = {Marx \\& Engels}");
    expect(out).toContain("series = {Vol\\_1}");
  });
});

describe("formatRecordRis", () => {
  it("starts with a TY tag and ends with ER", () => {
    const out = formatRecordRis(rec({ title: "X", authors: ["Doe, Jane"] }));
    expect(out).toMatch(/^TY {2}-/);
    expect(out.trimEnd()).toMatch(/ER {2}-\s*$/);
  });

  it("writes each author on its own AU line", () => {
    const out = formatRecordRis(rec({ authors: ["Doe, Jane", "Roe, Rick"] }));
    const auLines = out.split("\n").filter((l) => l.startsWith("AU  -"));
    expect(auLines).toHaveLength(2);
  });

  it("collapses newlines in title/abstract so RIS lines stay well-formed", () => {
    const out = formatRecordRis(
      rec({ title: "Line one\nline two", abstract: "para one\n\npara two" }),
    );
    // No line may start without a two-letter RIS tag + "  - ".
    for (const line of out.split("\n")) {
      if (line.trim()) expect(line).toMatch(/^[A-Z][A-Z0-9] {2}- /);
    }
    expect(out).toContain("TI  - Line one line two");
    expect(out).toContain("AB  - para one para two");
  });
});

describe("formatRecord('zotero')", () => {
  it("produces valid JSON with creators split into first/last", () => {
    const json = JSON.parse(
      formatRecord(
        rec({ title: "X", authors: ["Guido van Rossum"] }),
        "zotero",
      ),
    );
    expect(json.creators[0]).toMatchObject({
      creatorType: "author",
      lastName: "Rossum",
      firstName: "Guido van",
    });
  });

  it("maps a record with ISSN to journalArticle", () => {
    const json = JSON.parse(formatRecord(rec({ issn: "1234-5678" }), "zotero"));
    expect(json.itemType).toBe("journalArticle");
  });

  // Fixed (audit finding #1): the zotero exporter now honors record.document_type.
  it("honors document_type when choosing itemType", () => {
    expect(
      JSON.parse(formatRecord(rec({ document_type: "Thesis" }), "zotero"))
        .itemType,
    ).toBe("thesis");
    expect(
      JSON.parse(formatRecord(rec({ document_type: "Book Chapter" }), "zotero"))
        .itemType,
    ).toBe("bookSection");
  });

  // Fixed: a book that carries a series ISSN is no longer mis-typed as journalArticle.
  it("does not mis-type an ISBN book that also has a series ISSN", () => {
    const json = JSON.parse(
      formatRecord(rec({ isbn: "9783658310844", issn: "1234-5678" }), "zotero"),
    );
    expect(json.itemType).toBe("book");
  });
});

describe("formatRecord('text' / 'json')", () => {
  it("text format includes the title", () => {
    expect(formatRecord(rec({ title: "Hello World" }), "text")).toContain(
      "Title: Hello World",
    );
  });

  it("json format round-trips and omits raw_data by default", () => {
    const json = JSON.parse(
      formatRecord(rec({ title: "X", raw_data: "<xml/>" }), "json"),
    );
    expect(json.raw_data).toBeUndefined();
    expect(json.title).toBe("X");
  });
});

// PLAN 2.15 — regex/format rigor.
describe("BibTeX title / statement-of-responsibility strip", () => {
  it("strips the ISBD ' / Author' suffix", () => {
    const out = formatRecordBibtex(
      rec({ title: "The Great Work / by Jane Doe", authors: ["Jane Doe"] }),
    );
    expect(out).toContain("title = {The Great Work}");
  });

  it("preserves in-word slashes (no surrounding spaces)", () => {
    expect(formatRecordBibtex(rec({ title: "TCP/IP Illustrated" }))).toContain(
      "title = {TCP/IP Illustrated}",
    );
    expect(formatRecordBibtex(rec({ title: "Either/Or" }))).toContain(
      "title = {Either/Or}",
    );
  });
});

describe("RIS SN tag (ISBN/ISSN collision)", () => {
  it("emits a single SN — ISBN for books", () => {
    const lines = formatRecordRis(
      rec({ title: "A Book", isbn: "9783161484100", issn: "0378-5955" }),
    )
      .split("\n")
      .filter((l) => l.startsWith("SN  - "));
    expect(lines).toEqual(["SN  - 9783161484100"]);
  });

  it("emits a single SN — ISSN for journals", () => {
    const lines = formatRecordRis(
      rec({
        title: "An Article",
        journal_title: "Some Journal",
        isbn: "9783161484100",
        issn: "0378-5955",
      }),
    )
      .split("\n")
      .filter((l) => l.startsWith("SN  - "));
    expect(lines).toEqual(["SN  - 0378-5955"]);
  });
});
