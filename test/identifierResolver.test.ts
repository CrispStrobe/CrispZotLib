import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("identifier network resolvers", () => {
  let fetchStub: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchStub = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveDoi handles CSL-JSON success", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        title: "Test Title",
        author: [{ given: "John", family: "Doe" }],
        issued: { "date-parts": [[2023, 1, 1]] },
        publisher: "Test Pub",
        type: "journal-article",
        URL: "http://dx.doi.org/10.123/456",
        DOI: "10.123/456",
      }),
    } as any);

    const { resolveDoi } =
      await import("../src/modules/librarySearch/identifierResolver");
    const result = await resolveDoi("10.123/456");
    expect(result.title).toBe("Test Title");
    expect(result.authors).toEqual(["Doe, John"]);
    expect(result.year).toBe("2023");
    expect(result.publisher_name).toBe("Test Pub");
    expect(result.doi).toBe("10.123/456");
  });

  it("resolveDoi throws on error", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as any);

    const { resolveDoi } =
      await import("../src/modules/librarySearch/identifierResolver");
    await expect(resolveDoi("10.123/789")).rejects.toThrow("DOI lookup failed");
  });

  it("resolveIsbn checks Open Library then Google Books", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as any);
    fetchStub.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            volumeInfo: {
              title: "Google Book",
              authors: ["Author G"],
              publishedDate: "2021",
              pageCount: 123,
            },
          },
        ],
      }),
    } as any);

    const { resolveIsbn } =
      await import("../src/modules/librarySearch/identifierResolver");
    const result = await resolveIsbn("9781234567890");
    expect(result.title).toBe("Google Book");
    expect(result.authors).toEqual(["Author G"]);
    expect(result.year).toBe("2021");
    expect(result.pages).toBe("123");
  });

  it("resolvePmid works correctly", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          "12345": {
            title: "PubMed Title",
            authors: [{ name: "P. Author" }],
            pubdate: "2022 Jan 01",
            articleids: [{ idtype: "doi", value: "10.000/123" }],
          },
        },
      }),
    } as any);

    const { resolvePmid } =
      await import("../src/modules/librarySearch/identifierResolver");
    const result = await resolvePmid("12345");
    expect(result.title).toBe("PubMed Title");
    expect(result.authors).toEqual(["P. Author"]);
    expect(result.year).toBe("2022");
    expect(result.doi).toBe("10.000/123");
  });
});
