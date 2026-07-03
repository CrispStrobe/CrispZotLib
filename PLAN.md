# PLAN — CrispZotLib / CrispLib / citer: get all three working at feature parity

Goal: all three repos reach and stay at parity on **outgoing query → search → parse →
export** for every backend (SRU, OAI‑PMH, IxTheo, identifier resolution). Endpoint
knowledge and field mappings should be shared, not re‑diverged.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/needs decision

Repos (siblings under `~/code`):
- **CrispZotLib** — TypeScript Zotero 7 plugin (this repo). Entry: `src/modules/librarySearch/`.
- **CrispLib** — Python reference library (`sru_library.py`, `oai_pmh_library.py`, `ixtheo_library.py`, `identifier_resolver.py`).
- **citer** — Python Flask/Vercel citation tool (`lib/sru_client.py`, `lib/ixtheo_client.py`, identifier resolvers). SRU = DNB+BnF only; no OAI.

---

## Phase 0 — Baseline (DONE)
- [x] Full code audit (2 deep passes) — findings captured below.
- [x] Live‑tested every SRU/OAI endpoint; identified dead ones.
- [x] git sync: CrispZotLib pulled (was ‑3), citer pulled (was ‑16), CrispLib up‑to‑date (local edits preserved).
- [x] Lint 25 → 0; `tsc` clean.
- [x] vitest suite added (`test/`): 21 pass + 3 `it.fails` bug specs. `npm test`.
- [x] Zotero local API enabled & verified (`/api/users/0/items` → 200, 27,736 items). Enables live import testing.

---

## Phase 1 — Endpoint truth (verified live 2026‑07‑03)

### SRU
| id | status | action |
|----|--------|--------|
| dnb | ✅ works | keep |
| bnf | ✅ works | keep |
| zdb | ✅ works | keep |
| loc | ❌ lccn.loc.gov/sru = 404 | [x] repoint → `http://lx2.loc.gov:210/lcdb` (bath.* CQL) — **verify from Zotero; port 210 was blocked in sandbox** |
| kb | ❌ jsru.kb.nl/sru = 301 | [x] fix → `http://jsru.kb.nl/sru/sru` + `x-collection=GGC`, v1.2 (verified 102 hits) |
| bibsys | ❌ host NXDOMAIN | [x] fix → Alma `bibsys-network.alma.exlibrisgroup.com/view/sru/47BIBSYS_NETWORK`, alma.* CQL, marcxml, v1.2 (verified 3,732 hits) |
| trove | ❌ geo‑blocked, key‑only now | [x] flagged out — Trove v3 is a keyed REST API, not SRU |

New SRU added (verified live; the example-driven `buildSruQuery` handles their index families):
- [x] **K10plus** (GBV+SWB union) `https://sru.k10plus.de/opac-de-627`, `pica.*` — title/author/isbn all verified.
- [x] **SLSP swisscovery** `https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK`, `alma.*`, v1.2 — title/author/isbn all verified.
- [ ] B3Kat (Bavaria) + ÖBV (Austria): find correct Alma/port URLs (my guesses didn't connect), then add.

### OAI‑PMH
| id | status | action |
|----|--------|--------|
| dnb | ✅ | keep |
| europeana, mit, doaj, arxiv | ✅ | keep (arxiv slow) |
| crossref | ✅ (fixed) | [x] `api.crossref.org/oai` → `https://oai.crossref.org/oai`, prefix `cr_unixsd` (needs UNIXREF parser — see 2.7) |
| ddb | ✅ (fixed) | [x] → `https://oai.deutsche-digitale-bibliothek.de` |
| harvard | ✅ (fixed) | [x] → `https://dash.harvard.edu/oai/request` |
| kitopen | ✅ (fixed) | [x] → `https://dbkit.bibliothek.kit.edu/oai/` |
| dnb_digital | ❌ /repository_digital = 404 | [ ] remove or repoint (DNB digital sub‑repo appears discontinued) |
| loc (OAI) | ❌ memory.loc.gov = 503 | [ ] remove (LoC OAI discontinued) |
| **ezb** | ✅ added | [x] `https://ezb-oai.ur.de/zdb/oai2.php`, oai_dc+MARC21, sets `ezb:holdings:<ISIL>` (verified 2,500/page) |
| UB Leipzig | ⚠️ METS/MODS only | [ ] add only after MODS parser support (no oai_dc) |

---

## Phase 2 — CrispZotLib code fixes (audit findings)

### High severity (correctness / data loss) — live‑testable via Zotero API now
- [x] **2.1 Item typing ignores `document_type`.** Fixed: shared `mapRecordToItemType()` in `formatters.ts`, used by both the export (`formatRecord('zotero')`) and import (`integration.ts`) paths. document_type wins; ISBN before ISSN. All 11 target types verified to exist in Zotero's live schema.
- [x] **2.2 `setField` on invalid fields aborts import.** Fixed: each `setField` wrapped in try/catch (invalid field skipped, not fatal). Verified live that ISBN is not a valid field for journalArticle — the exact crash this prevents.
- [x] **2.3 No per‑item error isolation.** Fixed: each item wrapped in try/catch; successes/failures counted and reported; batch continues past a bad record.
- [x] **2.4 OAI pagination broken.** `searchService.ts:51‑55` discards `resumptionToken`; Next/Prev re‑runs page 1. Thread token through pagination state.
- [~] **2.5 Malformed XML swallowed.** `oaiClient`/`sruClient` — a `<parsererror>` doc reads as "0 results". Detect parse errors and surface them.
- [ ] **2.6 Import buttons not re‑entrancy guarded.** `integration.ts:234‑253` — add `isLoading` guard like the pagination handlers. Prevents double‑click duplicates.

### Medium
- [ ] **2.7 Crossref UNIXREF parser** — `cr_unixsd`/`cr_unixml` schema handling in `oaiClient` (Crossref has no oai_dc).
- [x] **2.8 BibTeX escaping for all fields** — Fixed: `escapeBibtex()` applied to title, author/editor/translator, journal, publisher, address, series, note (url/doi/isbn left raw). RIS escaping done (newline sanitization on title/abstract).
- [x] **2.9 Corporate/mononym author handling** — `formatters.ts` + `integration.ts` split "First Last" blindly; "United Nations" → "Nations, United". Detect corporate/single‑token names.
- [ ] **2.10 ISBN/ISSN regex false positives** — `oaiClient` `\d{9,}` matches URNs/DOIs; add checksum/`i`‑flag rigor.
- [x] **2.11 IxTheo fetch timeouts + bounded concurrency** — `searchService.ts:284,305‑361` raw fetches have no AbortController; dialog can hang forever.
- [ ] **2.12 Char‑encoding** — `response.text()` ignores XML‑declared latin‑1 (DNB); umlaut mojibake. Decode per declared charset.
- [x] **2.13 Placeholder "records" imported as junk** — `oaiClient` returns synthetic `[DELETED RECORD]`/`[Error…]` records that pass import guards. Return null instead.

### Low
- [x] **2.14** `innerHTML` with remote catalog data in privileged window (`integration.ts:136,151‑153`) → `textContent`.
- [ ] **2.15** Title `/ Author` strip regex over‑greedy; year regex 1000–2099 only; RIS ISBN+ISSN both as `SN`.

### New capability
- [x] **2.16 Port `identifier_resolver.py`** → TS (`identifierResolver.ts`). DOI (doi.org CSL‑JSON), PMID (NCBI), ISBN (OpenLibrary **+ Google Books fallback** — better than CrispLib's OL‑only), URL (Citoid). Returns `BiblioRecord`, `AbortController` timeouts. Detection unit‑tested (6 tests); DOI/PMID/ISBN paths live‑validated end‑to‑end. Wired into the search dialog as an "Import by Identifier" button (prompt -> resolve -> import).

### buildSruQuery index mapping
- [ ] **2.17** Generalize `searchService.buildSruQuery` for per‑endpoint index families: `TIT=`/`PER=` (DNB/ZDB), `bath.*` (LoC), `dc.*` (KB), `alma.*` (BIBSYS/swisscovery), `pica.*` (K10plus), CQL `bib.*` (BnF). Currently hard‑codes DNB/ZDB + example‑driven fallback.

---

## Phase 3 — CrispLib (Python) fixes
- [ ] **3.1** Commit the pending working‑tree edits (defusedxml XXE hardening, BibTeX editor‑ordering fix, type hygiene, new `identifier_resolver.py`) — user's own edits; review then commit. (LEFT TO USER)
- [x] **3.2 (SRU)** Applied loc/kb/bibsys fixes + wired `query_params` (KB x-collection) in `library_search.py`. Trove flagged out. **Live‑validated end‑to‑end through CrispLib CLI** (k10plus/kb/bibsys/swisscovery all return parsed records). CrispLib's OAI URLs were already correct (they were the source of the CrispZotLib OAI fixes).
- [ ] **3.2 (OAI)** Optional: add crossref (`oai.crossref.org`) + ezb to CrispLib OAI for parity.
- [x] **3.3** Added K10plus + swisscovery to CrispLib SRU table.
- [ ] **3.4** MARC parser "invalid predicate" warning (shared by CrispLib + citer). ROOT CAUSE: Python `ElementTree`/`defusedxml` do not support the XPath functions `contains()`, `text()`, `local-name()` used in the custom parser (e.g. `.//dc:identifier[contains(text(), "ISBN")]`, `.//*[local-name()="identifier"]`). The custom parser throws → falls back to `_generic_parse` (which works, so non‑fatal, but the richer custom parser is bypassed). FIX: replace those predicates with Python‑side filtering (find element, then test `.text`), or switch to `lxml.etree` which supports full XPath.

## Phase 4 — citer (Python) fixes
- [x] **4.1** Widened `search.py` SRU_ENDPOINTS from DNB+BnF to the full working set (dnb, bnf, zdb, loc, kb+x-collection, bibsys, k10plus, swisscovery) + wired `query_params`. **Live‑validated k10plus end‑to‑end via citer CLI.** (The `SRU_ENDPOINTS` in `lib/sru_client.py` is dead/unused — left as‑is.)
- [ ] **4.2** Verify IxTheo scraping still works (site‑redesign risk) in `lib/ixtheo_client.py`.
- [ ] **4.3** Decide scope: does citer gain OAI too, or stay identifier‑focused? (citer's strength is DOI/ISBN/PMID/OCLC resolution.)

## Phase 5 — Cross‑repo parity & tests
- [ ] **5.1** Single shared **endpoint manifest** (JSON) consumed by all three, so an endpoint fix lands once. TS reads it directly; Python loads the same file.
- [ ] **5.2** Adopt citer's offline **record/replay** test pattern in CrispZotLib: cache real SRU/OAI XML fixtures, assert TS parsers offline (needs an XPath shim for `@xmldom` on the SRU path).
- [ ] **5.3** Parity checklist: same endpoints, same query‑index mapping, same parse fields, same BibTeX/RIS output across all three.

---

## Verified reference data (2026‑07‑03, live)
- Zotero local API: `http://127.0.0.1:23119/api/users/0/…` (enable: Settings → Advanced → "Allow other applications on this computer to communicate with Zotero").
- Z39.50: **not usable from the plugin** (sandboxed JS = HTTPS only, no raw TCP/port 210). Use SRU successors (K10plus, swisscovery, Alma zones). Python repos *could* use Z39.50 via yaz/PyZ3950 but SRU is preferred.
