# Changelog

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
