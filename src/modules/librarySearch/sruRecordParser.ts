// src/modules/librarySearch/sruRecordParser.ts
//
// Pure record-shaping for the SRU Dublin Core / RDF / generic parse paths,
// extracted from sruClient.ts so it can be replay-tested fully offline (PLAN
// 7.4 / the deferred half of 5.2 — the MARCXML path already moved to the pure
// indexMarcRecord in 6.2).
//
// The previous code walked each record with `doc.evaluate(...)` and a prefixed
// XPath dialect (e.g. "./dc:title", ".//rdf:Description[not(@rdf:nodeID)]",
// "./foaf:primaryTopic | ./umbel:isLike"). @xmldom has no XPath engine, so those
// paths could not be exercised without a live Zotero DOM. This module reproduces
// the SAME semantics with plain DOM walking (childNodes / getElementsByTagNameNS
// / namespaceURI / localName), which behaves identically in Zotero and @xmldom.
//
// Crucially the walk stays NAMESPACE-AWARE, not just localName-based: the RDF
// path resolves dcterms:type → dc:type → rdf:type (and dcterms:subject vs
// dc:subject) by priority, and those share a localName. Matching on localName
// alone (as the OAI parser can, since its selectors were localName unions) would
// silently reorder that resolution. Prefixes resolve through the caller's
// namespace map (endpoints.json → NAMESPACES).

import { BiblioRecord } from "./models";

// @xmldom documents expose no Node global; ELEMENT_NODE is 1 everywhere.
const ELEMENT_NODE = 1;

function childElements(el: Element): Element[] {
  const out: Element[] = [];
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i] as unknown as Element;
    if (n.nodeType === ELEMENT_NODE) out.push(n);
  }
  return out;
}

/** First direct child with `local` (and, if given, namespace `nsUri`). */
function firstChild(
  el: Element,
  local: string,
  nsUri?: string,
): Element | null {
  for (const c of childElements(el)) {
    if (
      c.localName === local &&
      (nsUri === undefined || c.namespaceURI === nsUri)
    )
      return c;
  }
  return null;
}

/** All direct children with `local` (and, if given, namespace `nsUri`). */
function childrenOf(el: Element, local: string, nsUri?: string): Element[] {
  return childElements(el).filter(
    (c) =>
      c.localName === local &&
      (nsUri === undefined || c.namespaceURI === nsUri),
  );
}

/** Direct children matching ANY (local, nsUri) spec, in document order. */
function childrenMatchingAny(
  el: Element,
  specs: Array<[string, string | undefined]>,
): Element[] {
  return childElements(el).filter((c) =>
    specs.some(
      ([local, nsUri]) =>
        c.localName === local &&
        (nsUri === undefined || c.namespaceURI === nsUri),
    ),
  );
}

/** All descendants with `local`; `nsUri` undefined ⇒ any namespace. */
function descendantsOf(el: Element, local: string, nsUri?: string): Element[] {
  const nodes = el.getElementsByTagNameNS(nsUri ?? "*", local);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
}

/** First descendant with `local`; `nsUri` undefined ⇒ any namespace. */
function firstDescendant(
  el: Element,
  local: string,
  nsUri?: string,
): Element | null {
  const nodes = el.getElementsByTagNameNS(nsUri ?? "*", local);
  return nodes.length ? nodes[0] : null;
}

/**
 * MARC subfield elements for datafield `tag` / subfield `code`, namespace-
 * agnostic (marc:datafield vs mxc:datafield). Only used by the generic
 * fallback parser, which the old code expressed as
 * `.//marc:datafield[@tag="245"]/marc:subfield[@code="a"]`.
 */
function marcSubfields(el: Element, tag: string, code: string): Element[] {
  const out: Element[] = [];
  for (const df of descendantsOf(el, "datafield")) {
    if (df.getAttribute("tag") !== tag) continue;
    for (const sf of childElements(df)) {
      if (sf.localName === "subfield" && sf.getAttribute("code") === code)
        out.push(sf);
    }
  }
  return out;
}

/** Read an RDF resource/about reference off an element, or null. */
export function getResourceAttribute(element: Element): string | null {
  for (const prefix of ["rdf", ""]) {
    const attr =
      element.getAttribute(`${prefix}:resource`) ||
      element.getAttribute("resource");
    if (attr) return attr;
  }
  if (element.localName === "Description") {
    const aboutAttr =
      element.getAttribute("rdf:about") || element.getAttribute("about");
    if (aboutAttr) return aboutAttr;
  }
  return null;
}

// Strip life dates and role phrases that DC/RDF sources (esp. BnF) append to
// creator names, e.g. "Habermas, Jürgen (1929-2026). Auteur du texte".
export function cleanPersonName(name: string): string {
  if (!name) return name;
  let n = name.trim();
  n = n.replace(
    /\.\s*(?:Auteur|[ÉE]diteur|Traducteur|Pr[ée]facier|Collaborateur|Illustrateur|Annotateur|Directeur|Author|Editor|Translator|Contributor)[^.]*$/i,
    "",
  );
  n = n.replace(/\s*\(\s*\d{3,4}\s*-\s*\d{0,4}\.?\s*\)\s*$/, "");
  n = n.replace(/,?\s*\d{4}\s*-\s*\d{0,4}\s*$/, "");
  return n.trim().replace(/,\s*$/, "").trim();
}

/**
 * Map DC `dc:type` free text (dcmitype terms + BnF French labels, possibly
 * several joined) to a document_type for non-text material, or "" for text /
 * unknown. The returned values feed mapRecordToItemType (Video → videoRecording,
 * Audio → audioRecording, Image → artwork, Map → map, Software/Dataset →
 * computerProgram). "video" is tested before "image" so "moving image" wins.
 */
export function mapDcType(dcTypeText: string): string {
  const t = dcTypeText.toLowerCase();
  if (/moving image|image anim|\bvideo\b|\bfilm\b/.test(t)) return "Video";
  if (/\bsound\b|\baudio\b|\bmusic\b|musique|enregistrement sonore/.test(t))
    return "Audio";
  if (/still image|image fixe|photograph|\bartwork\b/.test(t)) return "Image";
  if (/cartograph|\bmap\b|\bcarte\b/.test(t)) return "Map";
  if (/software|logiciel/.test(t)) return "Software";
  if (/\bdataset\b|données de (?:la )?recherche/.test(t)) return "Dataset";
  return "";
}

function blankRecord(
  recordId: string,
  rawXml: string | undefined,
  schema: string,
): BiblioRecord {
  return {
    id: recordId,
    title: "Untitled",
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
    raw_data: rawXml,
    schema,
  };
}

/**
 * Parse a Dublin Core record element (the <recordData> or the <oai_dc:dc> under
 * it). Behaviour-identical to the previous SRUClient.parseDublinCore.
 */
export function parseSruDublinCore(
  element: Element,
  recordId: string,
  rawXml: string | undefined,
  ns: Record<string, string>,
): BiblioRecord {
  const record = blankRecord(recordId, rawXml, "dublincore");
  const dc = ns.dc;
  const find = (local: string) => firstDescendant(element, local, dc);
  const findAll = (local: string) => descendantsOf(element, local, dc);
  const seenNames = new Set<string>();

  const parseSourceString = (
    source: string,
  ): {
    journal_title?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    series?: string;
  } => {
    const result: {
      journal_title?: string;
      volume?: string;
      issue?: string;
      pages?: string;
      series?: string;
    } = {};
    const journalMatch =
      /([^,]+),\s*(?:Vol(?:ume)?\.?\s*(\d+))?,?\s*(?:No\.?\s*(\d+))?,?\s*(?:pp\.?\s*(\d+(?:-\d+)?))?/.exec(
        source,
      );
    if (journalMatch) {
      result.journal_title = journalMatch[1]?.trim();
      result.volume = journalMatch[2];
      result.issue = journalMatch[3];
      result.pages = journalMatch[4];
      return result;
    }
    if (/in:?/i.test(source)) {
      const bookMatch = /in:?\s*([^,]+)/i.exec(source);
      if (bookMatch) result.series = bookMatch[1]?.trim();
    }
    return result;
  };

  record.title = find("title")?.textContent?.trim() || "Untitled";

  const processName = (
    name: string | null | undefined,
    list: string[],
    roleList?: { name: string; role: string }[],
    defaultRole?: string,
  ) => {
    if (!name) return;
    name = cleanPersonName(name.trim());
    if (!name) return;
    let role = defaultRole || "author";
    let cleanName = name;
    if (/\b(?:ed(?:itor)?|hrsg|hg)\b|\(ed|\(hg/i.test(name)) {
      role = "editor";
    } else if (
      /\b(?:trans|transl|translator|übersetz|übers)\b|\(trans|\(übers/i.test(
        name,
      )
    ) {
      role = "translator";
    }
    cleanName = cleanName
      .replace(/\s*[([][^)]*(?:ed|hrsg|edit|hg|trans|übersetz)[^)]*[)\]]/g, "")
      .replace(
        /\s*(?:ed|hrsg|edit|hg|trans|transl|translator|übersetz|übers)\.?\s*$/g,
        "",
      )
      .trim();
    if (!cleanName || seenNames.has(cleanName)) return;
    seenNames.add(cleanName);
    if (role === "editor") record.editors.push(cleanName);
    else if (role === "translator") record.translators.push(cleanName);
    else if (role === "author") record.authors.push(cleanName);
    else if (roleList) roleList.push({ name: cleanName, role: role });
  };

  findAll("creator").forEach((elem) =>
    processName(elem.textContent, record.authors),
  );
  findAll("contributor").forEach((elem) =>
    processName(
      elem.textContent,
      record.authors,
      record.contributors,
      "contributor",
    ),
  );

  record.year = find("date")?.textContent?.match(/\b(1\d{3}|20\d{2})\b/)?.[1];
  record.publisher_name = find("publisher")?.textContent?.trim();
  findAll("identifier").forEach((elem) => {
    const idText = elem.textContent?.trim().toLowerCase();
    if (!idText) return;
    if (idText.includes("isbn")) {
      record.isbn =
        idText.match(/(?:isbn[:\s]*)?(\d[\d\-X]+)/)?.[1] || record.isbn;
    } else if (idText.includes("issn")) {
      record.issn =
        idText.match(/(?:issn[:\s]*)?(\d{4}-\d{3}[\dX])/)?.[1] || record.issn;
    } else if (idText.includes("doi") || idText.includes("doi.org")) {
      record.doi =
        idText.match(
          /(?:doi[:\s]*)?(?:https?:\/\/doi\.org\/)?(\d+\.\d+\/[^\s]+)/,
        )?.[1] || record.doi;
    } else if (idText.startsWith("http")) {
      record.urls.push(idText);
    }
  });
  findAll("subject").forEach((elem) => {
    if (elem.textContent?.trim()) record.subjects.push(elem.textContent.trim());
  });
  record.abstract = find("description")?.textContent?.trim();
  record.language = find("language")?.textContent?.trim();
  record.format = find("format")?.textContent?.trim();
  const source = find("source")?.textContent?.trim();
  if (source) {
    const parsedSource = parseSourceString(source);
    Object.assign(record, parsedSource);
  }

  // dc:type material typing (BnF etc. emit "moving image" / "image animée",
  // "sound", … per record). Without this, films/audio/maps fall through to the
  // isbn/format→Book fallback below and import into Zotero as books.
  const avType = mapDcType(
    findAll("type")
      .map((e) => e.textContent?.toLowerCase().trim() || "")
      .join(" | "),
  );

  if (record.journal_title && (record.volume || record.issue)) {
    record.document_type = "Journal Article";
  } else if (avType) {
    record.document_type = avType;
  } else if (record.series) {
    record.document_type = "Book Chapter";
  } else if (record.format?.toLowerCase().includes("book")) {
    record.document_type = "Book";
  } else if (record.issn) {
    record.document_type = "Journal";
  } else if (record.isbn) {
    record.document_type = "Book";
  }

  return record;
}

/**
 * Generic best-effort parser for records whose schema isn't dc/marcxml/RDFxml.
 * Behaviour-identical to the previous SRUClient.parseGeneric.
 */
export function parseSruGeneric(
  element: Element,
  recordId: string,
  rawXml: string | undefined,
  ns: Record<string, string>,
): BiblioRecord {
  const record = blankRecord(recordId, rawXml, "generic");

  // Title (first match wins across the fallback chain).
  const titleEl =
    firstDescendant(element, "title", ns.dc) ||
    firstDescendant(element, "title", ns.dcterms) ||
    firstDescendant(element, "title") ||
    marcSubfields(element, "245", "a")[0];
  if (titleEl?.textContent) record.title = titleEl.textContent.trim();

  // Authors/Contributors (all collected as authors, in document order).
  const creators = [
    ...childOrDescCreators(element, ns),
    ...marcSubfields(element, "100", "a"),
    ...marcSubfields(element, "700", "a"),
  ];
  creators.forEach((el) => {
    if (el.textContent?.trim()) record.authors.push(el.textContent.trim());
  });

  // Year (first match with a 4-digit year wins).
  const yearEls = [
    firstDescendant(element, "date", ns.dc),
    firstDescendant(element, "date", ns.dcterms),
    firstDescendant(element, "issued", ns.dcterms),
    firstDescendant(element, "date"),
    marcSubfields(element, "260", "c")[0],
    marcSubfields(element, "264", "c")[0],
  ];
  for (const el of yearEls) {
    const ym = el?.textContent?.match(/\b(1\d{3}|20\d{2})\b/);
    if (ym) {
      record.year = ym[1];
      break;
    }
  }

  // Publisher.
  const pubEls = [
    firstDescendant(element, "publisher", ns.dc),
    firstDescendant(element, "publisher", ns.dcterms),
    firstDescendant(element, "publisher"),
    marcSubfields(element, "260", "b")[0],
    marcSubfields(element, "264", "b")[0],
  ];
  for (const el of pubEls) {
    if (el?.textContent) {
      record.publisher_name = el.textContent.replace(/[,:]$/, "").trim();
      break;
    }
  }

  // ISBN.
  const isbnEls = [
    firstDescendant(element, "isbn13", ns.bibo),
    firstDescendant(element, "isbn10", ns.bibo),
    firstDescendant(element, "isbn", ns.bibo),
    descendantsOf(element, "identifier", ns.dc).find((e) =>
      e.textContent?.includes("ISBN"),
    ) ?? null,
    marcSubfields(element, "020", "a")[0],
  ];
  for (const el of isbnEls) {
    if (el?.textContent) {
      const im = el.textContent.match(/(?:ISBN[:\s]*)?(\d[\d\-X]+)/);
      record.isbn = im ? im[1] : el.textContent.trim();
      break;
    }
  }

  // URLs (union in document order, then MARC 856$u).
  const urlEls = [
    ...childrenMatchingAny(element, [
      ["primaryTopic", ns.foaf],
      ["isLike", ns.umbel],
    ]),
    ...descendantsOf(element, "identifier", ns.dc).filter((e) =>
      e.textContent?.includes("http"),
    ),
    ...marcSubfields(element, "856", "u"),
  ];
  urlEls.forEach((el) => {
    const res = getResourceAttribute(el);
    if (res?.startsWith("http") && !record.urls.includes(res))
      record.urls.push(res);
    else if (
      el.textContent?.trim().startsWith("http") &&
      !record.urls.includes(el.textContent.trim())
    )
      record.urls.push(el.textContent.trim());
  });

  return record;
}

// dc:creator / dcterms:creator / plain <creator> descendants, in document order.
function childOrDescCreators(
  element: Element,
  ns: Record<string, string>,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const el of [
    ...descendantsOf(element, "creator", ns.dc),
    ...descendantsOf(element, "creator", ns.dcterms),
    ...descendantsOf(element, "creator"),
  ]) {
    if (!seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

/**
 * Parse a DNB-style RDFxml record element. Behaviour-identical to the previous
 * SRUClient.parseRdfXml.
 */
export function parseSruRdfXml(
  element: Element,
  recordId: string,
  rawXml: string | undefined,
  ns: Record<string, string>,
): BiblioRecord {
  const record = blankRecord(recordId, rawXml, "RDFxml");
  const seenNames = new Set<string>();

  const processNameWithRole = (
    name: string | null | undefined,
  ): { cleanName: string | null; role: string; isDuplicate: boolean } => {
    if (!name) return { cleanName: null, role: "author", isDuplicate: true };
    name = cleanPersonName(name.trim());
    if (!name) return { cleanName: null, role: "author", isDuplicate: true };
    let role = "author";
    let cleanName = name;
    if (/\([Hh]g\.?\)|\([Hh]rsg\.?\)|\([Ee]d\.?\)/i.test(name)) {
      role = "editor";
    } else if (/\([Üü]bers\.?\)|\([Tt]rans\.?\)/i.test(name)) {
      role = "translator";
    }
    cleanName = cleanName
      .replace(/\s*\(.*?\)\s*$/, "")
      .replace(/[,.;]$/, "")
      .trim();
    if (!cleanName) return { cleanName: null, role, isDuplicate: true };
    const isDuplicate = seenNames.has(cleanName);
    if (!isDuplicate) seenNames.add(cleanName);
    return { cleanName, role, isDuplicate };
  };

  // The main <rdf:Description> for the item — the first one that is not a blank
  // node (rdf:nodeID). Linked entities (authors, GND subjects) follow it.
  const desc =
    descendantsOf(element, "Description", ns.rdf).find(
      (d) => !d.getAttribute("rdf:nodeID"),
    ) ?? null;
  if (!desc) {
    ztoolkit.log(`No main RDF:Description found in record ${recordId}`, "warn");
    return record;
  }

  const child = (local: string, nsUri?: string) =>
    firstChild(desc, local, nsUri);
  const childAll = (local: string, nsUri?: string) =>
    childrenOf(desc, local, nsUri);

  // --- Title and Subtitle ---
  record.title = child("title", ns.dc)?.textContent?.trim() || "Untitled";
  const subtitle = child("P60493", ns.rdau)?.textContent?.trim();
  if (
    subtitle &&
    record.title !== "Untitled" &&
    !record.title.includes(subtitle) &&
    !record.title.endsWith(":")
  ) {
    record.title += `: ${subtitle}`;
  } else if (subtitle && record.title === "Untitled") {
    record.title = subtitle;
  }

  // --- Author (Priority 1: statement of responsibility literal) ---
  const statementOfResponsibility = child(
    "P60327",
    ns.rdau,
  )?.textContent?.trim();
  if (statementOfResponsibility) {
    const potentialAuthors = statementOfResponsibility
      .split(";")[0]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    potentialAuthors.forEach((name) => {
      const { cleanName, role, isDuplicate } = processNameWithRole(name);
      if (cleanName && !isDuplicate && role === "author") {
        record.authors.push(cleanName);
      } else if (cleanName && !isDuplicate && role === "editor") {
        record.editors.push(cleanName);
      }
    });
  }

  // Priority 2: dcterms:creator (usually a GND link; keep literal fallback).
  if (record.authors.length === 0) {
    childAll("creator", ns.dcterms).forEach((creator) => {
      const resource = getResourceAttribute(creator);
      if (resource) {
        // Linked GND entity; the name isn't in this record.
      } else if (creator.textContent) {
        const { cleanName, role, isDuplicate } = processNameWithRole(
          creator.textContent,
        );
        if (cleanName && !isDuplicate && role === "author") {
          record.authors.push(cleanName);
        }
      }
    });
  }

  // --- Other fields ---
  record.year = child("issued", ns.dcterms)?.textContent?.match(
    /\b(1\d{3}|20\d{2})\b/,
  )?.[1];
  record.publisher_name = child("publisher", ns.dc)?.textContent?.trim();
  record.place_of_publication = child("P60163", ns.rdau)?.textContent?.trim();
  record.edition = child("edition", ns.bibo)?.textContent?.trim();

  record.extent =
    child("P1053", ns.isbd)?.textContent?.trim() ||
    child("extent", ns.dcterms)?.textContent?.trim();
  if (record.extent) {
    const pm = record.extent.match(/(\d+)\s*(?:S\.|Seiten)?/i);
    if (pm) record.pages = pm[1];
  }

  // Document type (priority dcterms:type → dc:type → rdf:type; infer Book from ISBN).
  const typeElement =
    child("type", ns.dcterms) || child("type", ns.dc) || child("type", ns.rdf);
  if (typeElement) {
    const res = getResourceAttribute(typeElement);
    const typeUri = res || typeElement.textContent?.trim();
    record.document_type = typeUri?.includes("/")
      ? typeUri.split("/").pop()
      : typeUri;
    if (record.document_type === "Document" || !record.document_type) {
      for (const isbnField of ["isbn13", "isbn10", "isbn", "gtin14"]) {
        const el = child(isbnField, ns.bibo);
        if (el?.textContent) {
          record.document_type = "Book";
          break;
        }
      }
    }
  } else {
    for (const isbnField of ["isbn13", "isbn10", "isbn", "gtin14"]) {
      const el = child(isbnField, ns.bibo);
      if (el?.textContent) {
        record.document_type = "Book";
        break;
      }
    }
  }
  record.format = record.document_type;

  // ISBN (first available).
  for (const isbnField of ["isbn13", "isbn10", "isbn", "gtin14"]) {
    const el = child(isbnField, ns.bibo);
    if (el?.textContent) {
      record.isbn = el.textContent.trim().replace(/-/g, "");
      break;
    }
  }
  record.issn = child("issn", ns.bibo)?.textContent?.trim();
  record.doi = child("doi", ns.bibo)?.textContent?.trim();

  // Subjects (GND links + DDC codes).
  const seenSubjects = new Set<string>();
  childAll("subject", ns.dcterms).forEach((subj) => {
    const res = getResourceAttribute(subj);
    if (res && res.includes("d-nb.info/gnd/")) {
      const gndId = res.split("/").pop();
      if (gndId && !seenSubjects.has(gndId)) {
        record.subjects.push(gndId);
        seenSubjects.add(gndId);
      }
    } else if (
      subj.textContent?.trim() &&
      !seenSubjects.has(subj.textContent.trim())
    ) {
      record.subjects.push(subj.textContent.trim());
      seenSubjects.add(subj.textContent.trim());
    }
  });
  const ddcDatatype =
    "https://d-nb.info/standards/elementset/dnb#ddc-subject-category";
  childAll("subject", ns.dc)
    .filter((s) => s.getAttribute("rdf:datatype") === ddcDatatype)
    .forEach((subj) => {
      const ddcCode = subj.textContent?.trim();
      if (ddcCode && !seenSubjects.has(`DDC:${ddcCode}`)) {
        record.subjects.push(`DDC:${ddcCode}`);
        seenSubjects.add(`DDC:${ddcCode}`);
      }
    });

  // Language.
  const langEl = child("language", ns.dcterms);
  if (langEl) {
    const res = getResourceAttribute(langEl);
    record.language = res ? res.split("/").pop() : langEl.textContent?.trim();
  }

  // Abstract.
  for (const [local, nsUri] of [
    ["description", ns.dc],
    ["abstract", ns.dcterms],
  ] as Array<[string, string]>) {
    const el = child(local, nsUri);
    if (el?.textContent) {
      record.abstract = el.textContent.trim();
      break;
    }
  }

  // URLs (foaf:primaryTopic | umbel:isLike | rdau:P60372, document order).
  childrenMatchingAny(desc, [
    ["primaryTopic", ns.foaf],
    ["isLike", ns.umbel],
    ["P60372", ns.rdau],
  ]).forEach((el) => {
    const res = getResourceAttribute(el);
    if (res?.startsWith("http") && !record.urls.includes(res)) {
      record.urls.push(res);
    } else if (
      el.textContent?.trim().startsWith("http") &&
      !record.urls.includes(el.textContent.trim())
    ) {
      record.urls.push(el.textContent.trim());
    }
  });

  return record;
}

/**
 * Collect every <recordData> element in an SRU response, namespace-agnostically.
 * Exposed for offline replay tests (mirrors collectOaiRecordElements).
 */
export function collectSruRecordDataElements(doc: Document): Element[] {
  const nodes = doc.getElementsByTagNameNS("*", "recordData");
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
}
