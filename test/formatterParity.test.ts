// Cross-language golden-file parity harness (PLAN 7.1).
//
// The fixture records + goldens in test/fixtures/parity/ are the CANONICAL
// contract for BibTeX/RIS formatter output, shared byte-for-byte with CrispLib
// (which asserts the same goldens from Python in test_formatter_parity.py).
// A failure here means the TS formatters diverged from the agreed output; a
// failure over there means Python diverged. Fix the formatter — or, for an
// intentional output change, regenerate the goldens and sync them:
//
//   UPDATE_GOLDENS=1 npx vitest run test/formatterParity.test.ts
//   scripts/sync-endpoints.sh   # copies fixtures+goldens to CrispLib
//
// then make CrispLib's formatters match and verify with pytest there.

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  formatRecordBibtex,
  formatRecordRis,
} from "../src/modules/librarySearch/formatters";
import type { BiblioRecord } from "../src/modules/librarySearch/models";

const FIXTURE_DIR = join(__dirname, "fixtures", "parity");

// Fixture records are sparse JSON; fill the array fields the formatters iterate.
function loadRecords(): BiblioRecord[] {
  const raw = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "records.json"), "utf-8"),
  ) as Partial<BiblioRecord>[];
  return raw.map((r) => ({
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
    ...r,
  })) as BiblioRecord[];
}

const records = loadRecords();
const bibtexActual =
  records.map((r) => formatRecordBibtex(r)).join("\n\n") + "\n";
const risActual = records.map((r) => formatRecordRis(r)).join("\n\n") + "\n";

if (process.env.UPDATE_GOLDENS) {
  writeFileSync(join(FIXTURE_DIR, "expected.bib"), bibtexActual);
  writeFileSync(join(FIXTURE_DIR, "expected.ris"), risActual);
}

describe("formatter parity goldens (shared with CrispLib)", () => {
  const bibtexGolden = readFileSync(join(FIXTURE_DIR, "expected.bib"), "utf-8");
  const risGolden = readFileSync(join(FIXTURE_DIR, "expected.ris"), "utf-8");
  const bibtexEntries = bibtexGolden.slice(0, -1).split("\n\n");
  const risEntries = risGolden.slice(0, -1).split("\n\n");

  it("golden files cover every fixture record", () => {
    expect(bibtexEntries.length).toBe(records.length);
    expect(risEntries.length).toBe(records.length);
  });

  // Per-record cases so a divergence names the offending fixture.
  records.forEach((record, i) => {
    it(`BibTeX matches golden for ${record.id}`, () => {
      expect(formatRecordBibtex(record)).toBe(bibtexEntries[i]);
    });
    it(`RIS matches golden for ${record.id}`, () => {
      expect(formatRecordRis(record)).toBe(risEntries[i]);
    });
  });

  it("whole .bib output is byte-identical to the golden", () => {
    expect(bibtexActual).toBe(bibtexGolden);
  });

  it("whole .ris output is byte-identical to the golden", () => {
    expect(risActual).toBe(risGolden);
  });
});
