// IxTheo's mnemonic MARC export parser (searchService.parseIxTheoMarc):
// standard indicator spellings and repeatable fields.
import { describe, expect, it } from "vitest";
import { SearchService } from "../src/modules/librarySearch/searchService";

const parse = (text: string) =>
  (SearchService as any).parseIxTheoMarc(text, () => {});

const MARC = [
  "=LDR  00000nam a2200000 c 4500",
  "=100  1\\$aSmith, Anna",
  "=245  10$aPython :$ba beginner's guide /",
  "=264  \\1$aBerlin :$bSpringer,$c2021",
  "=650  \\0$aEthics",
  "=650  \\0$aTheology",
  "=700  1\\$aDoe, John$eedt",
  "=700  1\\$aRoe, Richard",
  "=856  40$uhttps://example.org/a",
  "=856  4\\$uhttps://example.org/b",
].join("\n");

describe("parseIxTheoMarc", () => {
  const rec = parse(MARC);

  it("reads fields written with blank '\\' indicators or no space before '$'", () => {
    expect(rec.title).toBe("Python: a beginner's guide");
    expect(rec.publisher_name).toBe("Springer");
    expect(rec.year).toBe("2021");
    expect(rec.format).toBe("Book");
  });

  it("collects every occurrence of repeatable fields", () => {
    expect(rec.authors).toEqual(["Smith, Anna", "Roe, Richard"]);
    expect(rec.editors).toEqual(["Doe, John"]);
    expect(rec.subjects).toEqual(["Ethics", "Theology"]);
    expect(rec.urls).toEqual([
      "https://example.org/a",
      "https://example.org/b",
    ]);
  });
});
