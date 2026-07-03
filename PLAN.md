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

| id     | status                       | action                                                                                                                                         |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| dnb    | ✅ works                     | keep                                                                                                                                           |
| bnf    | ✅ works                     | keep                                                                                                                                           |
| zdb    | ✅ works                     | keep                                                                                                                                           |
| loc    | ✅ works                     | [x] repoint → `http://lx2.loc.gov:210/lcdb` (bath.\* CQL) — **verified live 2026-07-03: port 210 reachable, `bath.title=Python` → 1,370 hits** |
| kb     | ❌ jsru.kb.nl/sru = 301      | [x] fix → `http://jsru.kb.nl/sru/sru` + `x-collection=GGC`, v1.2 (verified 102 hits)                                                           |
| bibsys | ❌ host NXDOMAIN             | [x] fix → Alma `bibsys-network.alma.exlibrisgroup.com/view/sru/47BIBSYS_NETWORK`, alma.\* CQL, marcxml, v1.2 (verified 3,732 hits)             |
| trove  | ❌ geo‑blocked, key‑only now | [x] flagged out — Trove v3 is a keyed REST API, not SRU                                                                                        |

New SRU added (verified live; the example-driven `buildSruQuery` handles their index families):

- [x] **K10plus** (GBV+SWB union) `https://sru.k10plus.de/opac-de-627`, `pica.*` — title/author/isbn all verified.
- [x] **SLSP swisscovery** `https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK`, `alma.*`, v1.2 — title/author/isbn all verified.
- [x] **B3Kat** (Bibliotheksverbund Bayern + KOBV) `http://bvbr.bib-bvb.de:5661/bvb01sru`, `marcxml.*`, v1.1 — verified live 2026-07-03 (title 3764 / creator 1564 / isbn 4 / title+creator 9).
- [x] **ÖBV** (OBVSG / Austrian Library Network) `https://obv-at-obvsg.userservices.exlibrisgroup.com/view/sru/43ACC_NETWORK`, `alma.*`, v1.2 — verified live 2026-07-03 (title 5560 / creator 1264 / isbn 4 / title+creator 3).

### OAI‑PMH

| id                          | status                       | action                                                                                                                                                                                                     |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dnb                         | ✅                           | keep                                                                                                                                                                                                       |
| europeana, mit, doaj, arxiv | ✅                           | keep (arxiv slow)                                                                                                                                                                                          |
| crossref                    | ❌ UNIXREF only              | [x] removed in `1c866e4` (serves only `cr_unixsd`/UNIXREF, not oai_dc — see 2.7). Crossref DOIs covered by `resolveDoi`.                                                                                   |
| ddb                         | ✅ (fixed)                   | [x] → `https://oai.deutsche-digitale-bibliothek.de`                                                                                                                                                        |
| harvard                     | ✅ (fixed)                   | [x] → `https://dash.harvard.edu/oai/request`                                                                                                                                                               |
| kitopen                     | ✅ (fixed)                   | [x] → `https://dbkit.bibliothek.kit.edu/oai/`                                                                                                                                                              |
| dnb_digital                 | ❌ /repository_digital = 404 | [x] removed in `91aac30` (DNB digital sub‑repo discontinued)                                                                                                                                               |
| loc (OAI)                   | ❌ memory.loc.gov = 503      | [x] removed in `91aac30` (LoC OAI discontinued)                                                                                                                                                            |
| **ezb**                     | ✅ added                     | [x] `https://ezb-oai.ur.de/zdb/oai2.php`, oai_dc+MARC21, sets `ezb:holdings:<ISIL>` (verified 2,500/page)                                                                                                  |
| UB Leipzig                  | ⚠️ METS/MODS only            | [!] deferred — needs a MODS parser (no oai_dc) AND a working host (probed digital/www/nubbon `.ub.uni-leipzig.de` OAI 2026-07-03: NXDOMAIN/404/503). Revisit if a reachable oai_dc/MODS endpoint is found. |

---

## Phase 2 — CrispZotLib code fixes (audit findings)

### High severity (correctness / data loss) — live‑testable via Zotero API now

- [x] **2.1 Item typing ignores `document_type`.** Fixed: shared `mapRecordToItemType()` in `formatters.ts`, used by both the export (`formatRecord('zotero')`) and import (`integration.ts`) paths. document_type wins; ISBN before ISSN. All 11 target types verified to exist in Zotero's live schema.
- [x] **2.2 `setField` on invalid fields aborts import.** Fixed: each `setField` wrapped in try/catch (invalid field skipped, not fatal). Verified live that ISBN is not a valid field for journalArticle — the exact crash this prevents.
- [x] **2.3 No per‑item error isolation.** Fixed: each item wrapped in try/catch; successes/failures counted and reported; batch continues past a bad record.
- [x] **2.4 OAI pagination broken.** `searchService.ts:51‑55` discards `resumptionToken`; Next/Prev re‑runs page 1. Thread token through pagination state.
- [x] **2.5 Malformed XML swallowed.** Fixed: SRU already checked `<parsererror>`; added `OAIClient.parseXml()` throwing on `<parsererror>` at all 5 OAI parse sites, so a malformed/truncated response is logged as a failure instead of a silent "0 results".
- [x] **2.6 Import buttons not re‑entrancy guarded.** Fixed: both import buttons (selected/all) guarded with `dialogData.isLoading` + reset in `finally`, mirroring the pagination handlers. Prevents double‑click duplicates.

### Medium

- [x] **2.7 Crossref UNIXREF parser** — **superseded.** The Crossref OAI endpoint was removed in `1c866e4` (it only serves `cr_unixsd`/UNIXREF, not oai_dc). No Crossref OAI endpoint remains to parse for, and Crossref DOI metadata is already reachable via `identifierResolver.resolveDoi` (doi.org CSL‑JSON, Crossref‑backed). Writing a UNIXREF parser would mean re‑adding a deliberately‑removed endpoint; deferred unless Crossref OAI is reinstated.
- [x] **2.8 BibTeX escaping for all fields** — Fixed: `escapeBibtex()` applied to title, author/editor/translator, journal, publisher, address, series, note (url/doi/isbn left raw). RIS escaping done (newline sanitization on title/abstract).
- [x] **2.9 Corporate/mononym author handling** — `formatters.ts` + `integration.ts` split "First Last" blindly; "United Nations" → "Nations, United". Detect corporate/single‑token names.
- [x] **2.10 ISBN/ISSN regex false positives** — Fixed: new `recordUtils.ts` with checksum‑validated `extractIsbn`/`extractIssn` (length + mod‑11/mod‑10), used at both OAI identifier sites. Rejects DOIs/URNs/date strings the old `\d[\d-X]{9,}` accepted. 11 unit tests.
- [x] **2.11 IxTheo fetch timeouts + bounded concurrency** — `searchService.ts:284,305‑361` raw fetches have no AbortController; dialog can hang forever.
- [x] **2.12 Char‑encoding** — Fixed: `httpUtils.decodeXml`/`readXml` decode by declared charset (HTTP `Content-Type`, then XML prolog, else UTF‑8), used at all OAI + SRU read sites. Fixes DNB latin‑1 umlaut mojibake from `response.text()`'s UTF‑8 default. 5 unit tests.
- [x] **2.13 Placeholder "records" imported as junk** — `oaiClient` returns synthetic `[DELETED RECORD]`/`[Error…]` records that pass import guards. Return null instead.

### Low

- [x] **2.14** `innerHTML` with remote catalog data in privileged window (`integration.ts:136,151‑153`) → `textContent`.
- [x] **2.15** Fixed: BibTeX title strip now requires whitespace around the ISBD slash (`/\s+\/\s+/`) so "TCP/IP"/"Either/Or" survive; OAI year regex widened to 1000–2199; RIS emits a single type‑appropriate `SN` (ISBN for books, ISSN for periodicals) and no longer mistypes a book with a series ISSN as JOUR. 6 unit tests.

### New capability

- [x] **2.16 Port `identifier_resolver.py`** → TS (`identifierResolver.ts`). DOI (doi.org CSL‑JSON), PMID (NCBI), ISBN (OpenLibrary **+ Google Books fallback** — better than CrispLib's OL‑only), URL (Citoid). Returns `BiblioRecord`, `AbortController` timeouts. Detection unit‑tested (6 tests); DOI/PMID/ISBN paths live‑validated end‑to‑end. Wired into the search dialog as an "Import by Identifier" button (prompt -> resolve -> import).

### buildSruQuery index mapping

- [x] **2.17** Done: replaced the scattered DNB/ZDB/BnF conditionals in `buildSruQuery` with a declarative `SRU_INDEX_FAMILIES` table (index prefix + relation + join + all‑fields builder); `bath.*`/`dc.*`/`alma.*`/`pica.*` endpoints keep using the example‑driven inference from `endpoints.json`. Behavior‑preserving — live‑verified generated queries return results (DNB `TIT=`/`NUM=`, ZDB `TIT=`, BnF `bib.title any`, K10plus `pica.tit=`).

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
- [~] **5.2** Adopt citer's offline **record/replay** test pattern in CrispZotLib: cache real SRU/OAI XML fixtures, assert TS parsers offline. SRU MARC path no longer needs an `@xmldom` XPath shim — `indexMarcRecord` (6.2) is `doc.evaluate`-free and offline-tested; OAI/DC paths still need the shim.
- [ ] **5.3** Parity checklist: same endpoints, same query‑index mapping, same parse fields, same BibTeX/RIS output across all three.

---

## Phase 6 — Performance & hardening (2026‑07‑03)

Internal optimization pass — no endpoint or user‑facing behaviour changes. Gate: `tsc` clean · 44 vitest pass (+6 new) · eslint clean · bundle builds.

- [x] **6.1 Shared HTTP timeout + retry.** New `librarySearch/httpUtils.ts` — `fetchWithTimeout(url, init, timeoutMs, retries)` with an `AbortController` timeout **and** exponential‑backoff retry (network errors / timeouts / 5xx). Wired into all 5 `oaiClient` fetches + the `sruClient` fetch (`retries=2`); the two pre‑existing copies in `searchService`/`identifierResolver` collapsed onto it. Extends 2.11 (was IxTheo‑only) to every client — a hung catalog can no longer stall a search indefinitely (the `timeout` field was stored but never applied).
- [x] **6.2 SRU MARCXML parse: one‑pass index.** `parseMarcXml` ran `doc.evaluate('.//*[local-name()=…]')` (full subtree scan) on each of ~30 field lookups per record. New pure, exported `indexMarcRecord()` walks the record once (namespace‑agnostic via `getElementsByTagNameNS`/`localName`, no `doc.evaluate`). 4 dead XPath helpers removed. Now offline‑testable → `test/marcIndex.test.ts` (6 cases); previously zero coverage. Unblocks the SRU half of 5.2.
- [x] **6.3 IxTheo detail HTML: hoist NodeList.** `parseIxTheoDetailPageHtml` re‑ran the same `querySelectorAll('.description-tab … th')` ~13×/record; resolved once and shared.
- [x] **6.4 Dead code / dedup.** Removed the duplicated `createStyledDialog` from `searchDialog.ts` (now imports `utils/dialogUtils`), dead `showDebugDialog`, and the `find_script*.sh` scratch scripts. Bundle 397,453 → 393,394 B.
- [x] **6.5 CI.** Added a `test` job (`npm test` was never run in CI); fixed the build artifact path (`build` → `.scaffold/build/*.xpi`, which was archiving nothing); `npm install` → `npm ci` across all workflows.
- [x] **6.6 OAI DNB N+1.** Done: live‑verified against services.dnb.de that `ListRecords` returns full metadata (50/page) + resumptionToken in ONE request (HTTP 200, no 413, even on a wider date window) — the 413 fear was misattributed (413 = request‑too‑large, irrelevant to GET‑verb OAI). Rerouted DNB through the standard `ListRecords` path (forced date range + default `dnb` set retained), gaining pagination and cutting ~51 requests → 1. Removed the dead `searchWithIdentifiers` (‑112 lines).
- [!] **6.7 Repo‑wide Prettier drift.** `prettier --check .` flags 45 files incl. ones untouched by this pass (`tsconfig.json`, `typings/`), so the `lint` CI job is red on its own baseline. Left alone (a repo‑wide `--write` would fight the intentional dense one‑liners). Decide: reformat all vs. scope via `.prettierignore`.

---

## Verified reference data (2026‑07‑03, live)

- Zotero local API: `http://127.0.0.1:23119/api/users/0/…` (enable: Settings → Advanced → "Allow other applications on this computer to communicate with Zotero").
- Z39.50: **not usable from the plugin** (sandboxed JS = HTTPS only, no raw TCP/port 210). Use SRU successors (K10plus, swisscovery, Alma zones). Python repos _could_ use Z39.50 via yaz/PyZ3950 but SRU is preferred.
