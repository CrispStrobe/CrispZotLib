// Unit tests for the pure identifier-detection logic. Network resolvers are not
// exercised here (they hit live APIs); detection is pure and runs offline.
import { describe, it, expect } from "vitest";
import { detectIdentifierType } from "../src/modules/librarySearch/identifierResolver";

describe("detectIdentifierType", () => {
  it("detects bare DOIs", () => {
    expect(detectIdentifierType("10.1038/nphys1170")).toBe("doi");
    expect(detectIdentifierType("doi:10.1038/nphys1170")).toBe("doi");
  });

  it("detects DOI URLs as doi, other URLs as url", () => {
    expect(detectIdentifierType("https://doi.org/10.1038/nphys1170")).toBe(
      "doi",
    );
    expect(detectIdentifierType("https://example.com/article")).toBe("url");
  });

  it("detects ISBN-10 and ISBN-13 (with or without hyphens)", () => {
    expect(detectIdentifierType("9783658310844")).toBe("isbn");
    expect(detectIdentifierType("978-3-658-31084-4")).toBe("isbn");
    expect(detectIdentifierType("0306406152")).toBe("isbn");
  });

  it("detects PMIDs", () => {
    expect(detectIdentifierType("pmid:12345678")).toBe("pmid");
    expect(detectIdentifierType("29622564")).toBe("pmid");
  });

  it("detects PMC ids", () => {
    expect(detectIdentifierType("PMC5334499")).toBe("pmcid");
  });

  it("returns null for unrecognized input", () => {
    expect(detectIdentifierType("")).toBeNull();
    expect(detectIdentifierType("not an identifier")).toBeNull();
  });
});
