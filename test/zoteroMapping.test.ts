// Unit tests for the record→Zotero mapping fixes (audit follow-up): dc:type AV
// typing (mapDcType), and the `zotero` formatter now keeping translators,
// contributors, numPages (from extent) and secondary URLs instead of dropping
// them. The live import path (integration.ts) mirrors this formatter but needs a
// running Zotero; the pure formatter is the testable proxy.
import { describe, expect, it } from "vitest";
import {
  formatRecord,
  mapRecordToItemType,
} from "../src/modules/librarySearch/formatters";
import { mapDcType } from "../src/modules/librarySearch/sruRecordParser";
import type { BiblioRecord } from "../src/modules/librarySearch/models";

function rec(partial: Partial<BiblioRecord>): BiblioRecord {
  return {
    id: "t",
    title: "T",
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
    ...partial,
  };
}

describe("mapDcType", () => {
  it("maps AV / image / map / software / dataset, text → ''", () => {
    expect(mapDcType("image animée | moving image")).toBe("Video");
    expect(mapDcType("son | sound")).toBe("Audio");
    expect(mapDcType("enregistrement sonore")).toBe("Audio");
    expect(mapDcType("still image")).toBe("Image");
    expect(mapDcType("cartographic material")).toBe("Map");
    expect(mapDcType("software")).toBe("Software");
    expect(mapDcType("dataset")).toBe("Dataset");
    expect(mapDcType("texte imprimé | printed text | text")).toBe("");
  });

  it("prefers Video over Image for 'moving image'", () => {
    expect(mapDcType("moving image")).toBe("Video");
  });
});

describe("mapRecordToItemType chains AV document_type to Zotero types", () => {
  it("Video→videoRecording, Audio→audioRecording, Image→artwork, Map→map", () => {
    expect(mapRecordToItemType(rec({ document_type: "Video" }))).toBe(
      "videoRecording",
    );
    expect(mapRecordToItemType(rec({ document_type: "Audio" }))).toBe(
      "audioRecording",
    );
    expect(mapRecordToItemType(rec({ document_type: "Image" }))).toBe(
      "artwork",
    );
    expect(mapRecordToItemType(rec({ document_type: "Map" }))).toBe("map");
    expect(mapRecordToItemType(rec({ document_type: "Software" }))).toBe(
      "computerProgram",
    );
  });
});

describe("zotero formatter keeps previously-dropped data", () => {
  const zotero = JSON.parse(
    formatRecord(
      rec({
        document_type: "Video",
        authors: ["Tornatore, Giuseppe"],
        translators: ["Schmidt, Paul"],
        contributors: [
          { name: "Morricone, Ennio", role: "contributor" },
          { name: "Bergakademie Freiberg", role: "corporate" },
        ],
      }),
      "zotero",
    ),
  );

  it("adds translators and contributors as creators (not dropped)", () => {
    const byType = (t: string) =>
      zotero.creators.filter((c: any) => c.creatorType === t);
    expect(byType("author")).toHaveLength(1);
    expect(byType("translator")).toHaveLength(1);
    expect(byType("contributor")).toHaveLength(2);
  });

  it("keeps a corporate contributor single-field", () => {
    const corp = zotero.creators.find(
      (c: any) => c.name === "Bergakademie Freiberg",
    );
    expect(corp).toMatchObject({ creatorType: "contributor", fieldMode: 1 });
  });

  it("maps extent→numPages and extra URLs→extra", () => {
    const z = JSON.parse(
      formatRecord(
        rec({
          document_type: "Book",
          isbn: "9783161500000",
          extent: "350 Seiten",
          urls: ["https://a.example/main", "https://b.example/toc"],
        }),
        "zotero",
      ),
    );
    expect(z.numPages).toBe("350");
    expect(z.url).toBe("https://a.example/main");
    expect(z.extra).toContain("https://b.example/toc");
  });
});
