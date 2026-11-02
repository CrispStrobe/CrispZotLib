# Changelog

## Unreleased

### Fixes

- **OAI-PMH paging no longer skips records.** A harvested page (DNB: 50
  records) was cut to the requested size, but "Next" followed the server's
  token past the whole page. Whole pages are now shown, and a failed
  Previous/Next no longer desyncs the page history.
- **Rate limits are retried.** HTTP 429 now counts as transient, and the
  retry waits for the server's `Retry-After` (capped at 10 s). The weekly
  endpoint probe skips a host that is rate-limiting GitHub's runners
  instead of reporting it dead (issue #37, harvard).
- **Better metadata from Dublin Core and MARC.**
  - ISBN/ISSN check digit "X" and URL case are kept.
  - Names ending in "ed" ("Smith, Fred") are no longer truncated.
  - "TCP/IP"-style titles stay whole.
  - Springer DOIs that embed an ISBN stay DOIs.
  - ISBD punctuation is stripped from MARC titles.
  - Choosing "DC" on DNB/ZDB uses the proper Dublin Core parser.
- **IxTheo.** All co-authors, subjects and URLs come through (only the
  first of each was kept). Detail data no longer erases list-page values,
  and detail fetches are rate-capped.
- **Searches with special characters** ("TCP/IP", quotes) produce valid CQL.
- **PMCIDs** resolve via PubMed Central (they previously hit unrelated
  PubMed articles). DOIs ending in ")" or containing "<>" are kept intact.
- **Security:** remote OAI set names are no longer inserted as HTML.
- **Clean shutdown:** the error handler and the theme observers are now
  removed when the add-on is disabled.

### Maintenance

- Updated all dependencies, including zotero-plugin-toolkit 6 and GitHub
  Actions v7. `npm audit` is clean. TypeScript stays on 6.0 until
  typescript-eslint supports 7.
- Removed unused modules.

## 0.2.0

Catalogue coverage, correctness, and the record → Zotero handoff. See `PLAN.md`
(Phase 8) for the full detail; highlights:

### Endpoints

- **Added hebis** (Hesse + Rhineland-Palatinate union catalogue,
  `sru.hebis.de`). It returns namespace-less MARCXML; the plugin handles that
  (it matches datafields in any namespace).

### Correct item types

- **Audio-visual material is typed correctly.** The Dublin Core and OAI parsers
  now read `dc:type`, so films → Video, recordings → Audio, images → Image, maps
  → Map, software/datasets → Software (previously everything DC/OAI became a
  book). BnF and Europeana/DDB benefit most.

### More complete Zotero items

- **Contributors are no longer dropped.** Corporate bodies, film crew, thesis
  advisors and other non-author/editor/translator roles now import as Zotero
  `contributor` creators instead of vanishing.
- **Creator types are validated against the item type.** A film's people now
  import as director/cast/contributor rather than being rejected — previously an
  invalid creator type could silently lose the whole item.
- **Page counts** (`extent` → `numPages`) and **secondary URLs** (table of
  contents, cover, resolver → the `Extra` field) are preserved.
- **Identifiers survive on any item type.** A DOI on a book, an ISSN on a serial,
  or a publisher on a film — fields the item type has no native slot for — now go
  to the `Extra` field instead of being silently dropped. Verified by dry-running
  100 live records through the import mapping against Zotero's real schema.

### Name cleaning

- **BnF French names** like `Tornatore, Giuseppe (1956-....). Réalisateur` now
  come through as `Tornatore, Giuseppe` — open-ended life dates and a much wider
  FR/DE/EN relator vocabulary are stripped, while ordinary names with periods
  (`Smith, J. R.`) are left intact.

### Bug fixes

- German author relators `Verfasser` and the full word `Herausgeber` in MARC
  `$e` now map to author / editor (were mis-filed as contributors).
- The last XPath-based parse path (SRU Dublin Core / RDF) is now a pure,
  offline-tested walker.

### Under the hood

- Every parser is now covered by offline replay/parity tests; a shared golden
  asserts the TypeScript and Python parsers agree.
- `npm run validate:zotero` checks the field/creator mappings against a running
  Zotero's live schema (it caught two of the fixes above).
