// Unit tests for the identifier extraction/validation helpers (PLAN 2.10).
import { describe, it, expect } from "vitest";
import {
  extractIsbn,
  extractIssn,
  isValidIsbn10,
  isValidIsbn13,
  isValidIssn,
} from "../src/modules/librarySearch/recordUtils";

describe("isValidIsbn10 / isValidIsbn13", () => {
  it("accepts valid ISBN-10 including trailing X", () => {
    expect(isValidIsbn10("0306406152")).toBe(true);
    expect(isValidIsbn10("080442957X")).toBe(true);
  });
  it("rejects bad ISBN-10 checksums and shapes", () => {
    expect(isValidIsbn10("0306406153")).toBe(false);
    expect(isValidIsbn10("123456789")).toBe(false); // too short
  });
  it("accepts valid ISBN-13 and rejects bad ones", () => {
    expect(isValidIsbn13("9783161484100")).toBe(true);
    expect(isValidIsbn13("9783161484101")).toBe(false);
  });
});

describe("extractIsbn", () => {
  it("pulls a hyphenated ISBN-13 out of noisy text with a price qualifier", () => {
    expect(extractIsbn("978-3-16-148410-0 : EUR 24.00")).toBe("9783161484100");
  });
  it("pulls an ISBN-10 with X check digit", () => {
    expect(extractIsbn("ISBN 0-8044-2957-X (pbk.)")).toBe("080442957X");
  });
  it("rejects a DOI and a URN (false positives the old regex accepted)", () => {
    expect(extractIsbn("10.1234/journal.2020.123456")).toBeNull();
    expect(extractIsbn("urn:nbn:de:101:1-2016072812345")).toBeNull();
  });
  it("rejects a 13-digit run that fails the checksum", () => {
    expect(extractIsbn("1234567890123")).toBeNull();
  });
});

describe("extractIssn", () => {
  it("normalizes a valid ISSN with and without hyphen", () => {
    expect(extractIssn("ISSN 0378-5955")).toBe("0378-5955");
    expect(extractIssn("03785955")).toBe("0378-5955");
  });
  it("accepts an X check digit", () => {
    expect(extractIssn("7000-000X")).toBe("7000-000X");
  });
  it("rejects a date-like string and a bad checksum", () => {
    expect(extractIssn("published 2024-018")).toBeNull();
    expect(extractIssn("0378-5956")).toBeNull();
  });
});

describe("isValidIssn", () => {
  it("validates the mod-11 checksum", () => {
    expect(isValidIssn("03785955")).toBe(true);
    expect(isValidIssn("7000000X")).toBe(true);
    expect(isValidIssn("03785956")).toBe(false);
  });
});
