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

- [x] **3.1** Committed the pending working‑tree edits: ported `identifier_resolver.py` (DOI/PMID/ISBN/URL → metadata; commit `d07a9b2`) + readme, and the `ixtheo_library.py` type‑hygiene cleanups (folded into `7fe2438`).
- [x] **3.2 (SRU)** Applied loc/kb/bibsys fixes + wired `query_params` (KB x-collection) in `library_search.py`. Trove flagged out. **Live‑validated end‑to‑end through CrispLib CLI** (k10plus/kb/bibsys/swisscovery all return parsed records). CrispLib's OAI URLs were already correct (they were the source of the CrispZotLib OAI fixes).
- [x] **3.2 (OAI)** Parity reached via the shared manifest — CrispLib loads OAI from `endpoints.json` (commit `161ac65`), so `ezb` is already present and `crossref` correctly absent (removed as UNIXREF‑only). Nothing repo‑specific to add.
- [x] **3.3** Added K10plus + swisscovery to CrispLib SRU table.
- [x] **3.4** Fixed in CrispLib (`10f8e58`). The broken `contains()`/`text()`/`local-name()` XPath was confined to `_generic_parse` (the rich `parse_marcxml`/`parse_dublin_core`/`parse_rdfxml` already iterate). Those predicates silently raised "invalid predicate" (caught), so DC records whose ISBN/ISSN/URL lived in `<dc:identifier>` text got none — replaced with Python‑side iteration over namespace‑agnostic `<identifier>` elements + a namespace‑agnostic `<title>` fallback. New offline test (7 pass).

## Phase 4 — citer (Python) fixes

- [x] **4.1** Widened `search.py` SRU_ENDPOINTS from DNB+BnF to the full working set (dnb, bnf, zdb, loc, kb+x-collection, bibsys, k10plus, swisscovery) + wired `query_params`. **Live‑validated k10plus end‑to‑end via citer CLI.** (The `SRU_ENDPOINTS` in `lib/sru_client.py` is dead/unused — left as‑is.)
- [x] **4.2** IxTheo added a JS **proof‑of‑work** anti‑bot wall (`sha256(nonce+ts+i)` startswith `0000` → `pow_token` cookie, 30 min) that broke scraping in **all three** repos (plain requests get the challenge page). Fixed in citer (`cd6c739`), CrispLib (`7fe2438`), and CrispZotLib (`54e0d3b`, `ixtheoPow.ts` via Web Crypto). Verified live end‑to‑end through CrispLib's `IxTheoClient` (`search('Habermas')` → 2181 hits, was 0).
- [!] **4.3** Decided: citer **stays identifier‑focused** (DOI/ISBN/PMID/OCLC resolution) — no OAI harvest added. OAI is a bulk‑harvest protocol that doesn't fit citer's single‑citation model; the SRU set already covers catalogue search there.

## Phase 5 — Cross‑repo parity & tests

- [x] **5.1** Shared **endpoint manifest** live: CrispZotLib is canonical (`endpoints.ts` re‑exports `endpoints.json`), CrispLib + citer load the same file, and `scripts/sync-endpoints.sh` keeps all three byte‑identical (`--check` verifies parity — now clean across all repos after the B3Kat/ÖBV sync).
- [x] **5.2** Record/replay landed for the SRU MARC path: `test/sruMarcReplay.test.ts` parses a **real captured** DNB response (`test/fixtures/dnb-marcxml-response.xml`) through the actual `parseMarcXml` fully offline (@xmldom + a `Node.ELEMENT_NODE` shim; no XPath engine, since `parseMarcXml` delegates to the `doc.evaluate`-free `indexMarcRecord`). The replay immediately caught a real bug (German `$e='Verfasser'` mis‑filed as contributor — fixed, see 5.3). The OAI/DC paths still use `doc.evaluate` and would need an `@xmldom` XPath shim for the same treatment — deferred.
- [x] **5.3** Parity audited across the four dimensions:
  - **Endpoints** — identical by construction: one shared `endpoints.json` (5.1), `sync-endpoints.sh --check` clean across all three.
  - **Query‑index mapping** — same source (`examples` in the manifest); CrispZotLib's `SRU_INDEX_FAMILIES` reproduces the DNB/ZDB/BnF strings the others derive from examples. Generated queries live‑verified for dnb/zdb/bnf/k10plus/b3kat/obv.
  - **Parse fields** — found + fixed a divergence: the `Verfasser` author‑relator bug existed in both CrispZotLib (`46e330a`) and CrispLib (`580c38c`); both now map verf/author/autor/creator → author, each with an offline test.
  - **IxTheo access** — the proof‑of‑work bypass (4.2) is implemented identically in all three, verified live via CrispLib's client.
  - Remaining gap: no single harness asserts byte‑identical BibTeX/RIS output across the TS and Python formatters on a shared fixture set — that cross‑language golden‑file comparison is the natural next parity step.

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

## Phase 7 — Guarding parity & closing coverage gaps (planned 2026‑07‑03)

Everything above is point‑in‑time verified; Phase 7 makes the guarantees _stay_ true.

- [x] **7.1 Cross‑language golden‑file parity harness** (the gap named in 5.3). DONE: 15 shared fixture records (`test/fixtures/parity/records.json`, chosen to hit every known divergence point — ISBD slash titles, series‑ISSN books, missing document_type, BibTeX specials, role markers, corporate/mononym names, multiline abstracts) + BibTeX/RIS goldens generated from the TS formatters (`UPDATE_GOLDENS=1 npx vitest run test/formatterParity.test.ts`). Asserted byte‑for‑byte by `test/formatterParity.test.ts` (33 tests) AND CrispLib's `test_formatter_parity.py` (31 tests); fixtures canonical here, synced via the generalized `scripts/sync-endpoints.sh`. Convergence fixes the harness forced: **CrispLib** got the 2.8/2.15 fixes it was missing (BibTeX escaping via shared `escape_bibtex`, `\s+/\s+` ISBD title rule, journal‑title→`@article` fallback, single type‑appropriate RIS `SN`, RIS `VL/IS/SP/DO/JO` — volume/issue/pages/DOI were silently dropped before, RIS newline sanitization); **both** repos got corporate‑aware + role‑marker‑stripped RIS `AU/ED` names ("United Nations" no longer flips to "Nations, United" — the 2.9 bug class existed in both RIS exports) and role‑marker stripping in TS BibTeX creator fields (Python already had it).
- [x] **7.2 Scheduled endpoint health probe.** DONE: `test/live/endpointHealth.test.ts` (env‑gated via `LIVE_PROBE=1`, skipped in the offline suite) replays each SRU endpoint's own `examples.title` query verbatim (requires numberOfRecords > 0), checks OAI `Identify` + that `ListMetadataFormats` still offers the `defaultMetadataPrefix` (catches Crossref‑style "host alive, format gone" rot), and canaries IxTheo by solving the real PoW via the plugin's own `solveIxTheoPow` and requiring result markers. `.github/workflows/endpoint-health.yml` runs it Mondays 05:17 UTC (+ manual dispatch) and opens/refreshes a "Endpoint health probe failing" issue with the failing checks on breakage. Validated live 2026‑07‑03: all 20 probes green (IxTheo PoW solve ≈ 9 s).
- [x] **7.3 OAI/DC offline replay** (deferred half of 5.2). DONE — nuance: the OAI path used `querySelectorAll("dc\\:title, title, *|title")` unions (not `doc.evaluate` as 5.2 assumed), which @xmldom equally lacks; the effective semantics were "match by localName in any namespace", so the parsers were rewritten onto plain namespace‑agnostic DOM walking (`childNodes`/`localName`, no selector engine — same behavior in Zotero and @xmldom). Record shaping now lives in pure `oaiRecordParser.ts` (`processOaiRecordElement`/`parseOaiDublinCore`/`parseOaiGeneric` + envelope helpers); `OAIClient` delegates. Replay tests (`test/oaiDcReplay.test.ts`, 13 tests) parse two REAL captured ListRecords responses: DNB `dnb:reiheC` (50 records — "Place : Publisher" split, ISBN validated out of "978‑3‑86514‑008‑1 keine Bindung", resumptionToken/completeListSize) and DOAJ (29 records incl. 3 real deleted ones skipped per 2.13, bare unprefixed ISSNs checksum‑detected) + synthetic role‑marker/`dc:source` cases.
- [~] **7.4 Testability‑first decomposition.** OAI half done via 7.3: `oaiClient.ts` 1,667 → 1,027 lines with all record shaping in the pure, tested `oaiRecordParser.ts` (566 lines). Remaining candidates (do when touching the code, not big‑bang): `sruClient`'s RDF/DC parse path still uses `doc.evaluate` with prefixed XPath unions (`./foaf:primaryTopic | …`) — same walker treatment would make it replay‑testable; `searchService`'s IxTheo HTML shaping and `searchDialog` UI glue remain untested.
- [x] **7.5 Small hardening.** DONE. (a) `npm run test:coverage` (@vitest/coverage‑v8, src‑scoped): pure modules well covered (recordUtils 100% lines, formatters 76%, oaiRecordParser 62%, sruClient 24% via marcIndex+replay); the 0% files are Zotero‑bound UI/network glue that needs a live Zotero, matching the 7.4 assessment. Also added `npm run probe:endpoints` for the 7.2 probe. (b) `fetch-depth: 0` dropped from all 3 CI jobs (kept in release.yml, which may need tags/history). (c) new `sync-check` CI job shallow‑clones the public CrispLib + citer repos and runs `sync-endpoints.sh --check` — a shared‑file edit without a sync (or an unpushed sibling) turns the build red. Note: this job needs the CrispLib parity‑fixture commit pushed to GitHub before it passes.

---

## Verified reference data (2026‑07‑03, live)

- Zotero local API: `http://127.0.0.1:23119/api/users/0/…` (enable: Settings → Advanced → "Allow other applications on this computer to communicate with Zotero").
- Z39.50: **not usable from the plugin** (sandboxed JS = HTTPS only, no raw TCP/port 210). Use SRU successors (K10plus, swisscovery, Alma zones). Python repos _could_ use Z39.50 via yaz/PyZ3950 but SRU is preferred.
