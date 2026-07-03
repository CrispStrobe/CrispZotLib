// oaiRecordParser.ts — pure OAI-PMH record parsing (PLAN 7.3/7.4).
//
// Extracted from OAIClient so the record-shaping logic is offline-testable.
// Deliberately avoids querySelectorAll and doc.evaluate: only childNodes /
// localName / getAttribute / textContent, which behave identically on Zotero's
// full DOM and on @xmldom's minimal DOM in vitest (same move as
// indexMarcRecord, PLAN 6.2). The old querySelectorAll("dc\\:title, title,
// *|title") unions were effectively "match by localName in any namespace" —
// that is what the walkers below implement directly.

import { BiblioRecord } from "./models";
import { extractIsbn, extractIssn } from "./recordUtils";

export type ParserLog = (
  message: string,
  level?: "log" | "warn" | "error",
) => void;
const noopLog: ParserLog = () => {};

// Node.ELEMENT_NODE as a literal: @xmldom documents have no Node global.
const ELEMENT_NODE = 1;

function childElements(el: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === ELEMENT_NODE) out.push(n as Element);
  }
  return out;
}

/** First child element, namespace-agnostic (Element.firstElementChild is not
 * available on @xmldom). */
export function firstChildElement(el: Element): Element | null {
  return childElements(el)[0] ?? null;
}

/**
 * All descendant elements whose localName is in `names`, in document order,
 * from a single walk. Matches any namespace (like the old `*|tag` selectors).
 */
export function findDescendantsByLocalName(
  root: Element,
  names: string[],
): Element[] {
  const wanted = new Set(names);
  const out: Element[] = [];
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      if (wanted.has(child.localName || child.nodeName)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

export function firstDescendantByLocalName(
  root: Element,
  name: string,
): Element | null {
  return findDescendantsByLocalName(root, [name])[0] ?? null;
}

/** One-pass index of ALL descendant elements keyed by localName. */
export function indexDescendantsByLocalName(
  root: Element,
): Map<string, Element[]> {
  const index = new Map<string, Element[]>();
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      const key = child.localName || child.nodeName;
      const bucket = index.get(key);
      if (bucket) bucket.push(child);
      else index.set(key, [child]);
      walk(child);
    }
  };
  walk(root);
  return index;
}

/**
 * The <record> children of a ListRecords/GetRecord response, in document
 * order (the OAI envelope equivalent of the old "ListRecords > record"
 * selector — but any <record> descendant works for both verbs).
 */
export function collectOaiRecordElements(doc: Document): Element[] {
  return findDescendantsByLocalName(doc.documentElement as Element, ["record"]);
}

/** The <resumptionToken> element of a ListRecords response, if any. */
export function findResumptionTokenElement(doc: Document): Element | null {
  return firstDescendantByLocalName(
    doc.documentElement as Element,
    "resumptionToken",
  );
}

/** Map a bracketed or keyword role marker in a raw creator string to a role. */
function detectRole(
  name: string,
  defaultRole: string,
): { role: string; cleanName: string } {
  let role = defaultRole;
  let cleanName = name;
  const roleMatch = name.match(/\s*\[([^\]]+)\]$/);
  if (roleMatch) {
    const roleText = roleMatch[1].toLowerCase();
    cleanName = name.substring(0, roleMatch.index).trim();
    if (
      roleText.includes("herausgeber") ||
      roleText.includes("hrsg") ||
      roleText.includes("editor") ||
      roleText.includes("ed.")
    ) {
      role = "editor";
    } else if (roleText.includes("übersetzer") || roleText.includes("transl")) {
      role = "translator";
    } else if (defaultRole === "contributor" && roleText) {
      role = roleText; // keep the specific role text for contributors
    }
  } else if (defaultRole === "contributor") {
    // Keyword roles without brackets (contributor field only)
    if (/\b(editor|ed\.|hrsg|hg\.)\b/i.test(name)) {
      role = "editor";
      cleanName = name.replace(/\b(editor|ed\.|hrsg|hg\.)\b/i, "").trim();
    } else if (/\b(translator|trans\.|übers)\b/i.test(name)) {
      role = "translator";
      cleanName = name.replace(/\b(translator|trans\.|übers)\b/i, "").trim();
    }
  }
  return { role, cleanName };
}

/**
 * Parse Dublin Core metadata. `dcElement` is the actual DC container (e.g.
 * <oai_dc:dc>). Extracted verbatim from OAIClient.parse_dublin_core.
 */
export function parseOaiDublinCore(
  dcElement: Element,
  identifier: string,
  log: ParserLog = noopLog,
): BiblioRecord | null {
  const logPrefix = "[parseOaiDublinCore]";
  if (!dcElement) {
    log(`${logPrefix} Received null dcElement for ${identifier}.`, "warn");
    return null;
  }

  const record: BiblioRecord = {
    id: identifier,
    title: "Untitled",
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
  };

  const index = indexDescendantsByLocalName(dcElement);
  const queryDC = (tagName: string): Element[] => index.get(tagName) ?? [];

  // Extract title
  const titleElements = queryDC("title");
  if (titleElements.length > 0 && titleElements[0].textContent) {
    record.title = titleElements[0].textContent.trim();
    // Clean up title - remove author info like " / Author Name" at the end
    record.title = record.title.replace(/\s*\/\s*[^/]+$/, "").trim();
  } else {
    log(`${logPrefix} No title found for ${identifier}.`, "warn");
  }

  // Track seen names to avoid duplicates across different fields
  const seenNames = new Set<string>();

  // --- Process dc:creator ---
  for (const creatorElem of queryDC("creator")) {
    const name = creatorElem.textContent?.trim();
    if (!name) continue;
    const { role, cleanName } = detectRole(name, "author");
    if (cleanName && !seenNames.has(cleanName)) {
      if (role === "editor") {
        record.editors.push(cleanName);
      } else if (role === "translator") {
        record.translators.push(cleanName);
      } else {
        record.authors.push(cleanName);
      }
      seenNames.add(cleanName);
    }
  }

  // --- Process dc:contributor ---
  for (const contribElem of queryDC("contributor")) {
    const name = contribElem.textContent?.trim();
    if (!name) continue;
    const { role, cleanName } = detectRole(name, "contributor");
    if (cleanName && !seenNames.has(cleanName)) {
      if (role === "editor") {
        record.editors.push(cleanName);
      } else if (role === "translator") {
        record.translators.push(cleanName);
      } else {
        record.contributors.push({ name: cleanName, role: role });
      }
      seenNames.add(cleanName);
    }
  }

  // Extract date/year
  for (const dateElem of queryDC("date")) {
    if (!dateElem.textContent) continue;
    const dateText = dateElem.textContent.trim();
    // Prioritize YYYY format
    const yearMatchYYYY = dateText.match(/^\b(1\d{3}|2[01]\d{2})\b$/);
    if (yearMatchYYYY) {
      record.year = yearMatchYYYY[1];
      break; // Found precise year, stop looking
    }
    if (!record.year) {
      const yearMatchAny = dateText.match(/\b(1\d{3}|2[01]\d{2})\b/);
      if (yearMatchAny) record.year = yearMatchAny[1];
    }
  }

  // Extract publisher and place ("Place : Publisher")
  const publisherElements = queryDC("publisher");
  if (publisherElements.length > 0 && publisherElements[0].textContent) {
    const publisherText = publisherElements[0].textContent.trim();
    const match = publisherText.match(/^([^:]+)\s*:\s*(.+)$/);
    if (match) {
      record.place_of_publication = match[1].trim();
      record.publisher_name = match[2].trim();
    } else {
      record.publisher_name = publisherText;
    }
  }

  // Extract format
  const formatElements = queryDC("format");
  if (formatElements.length > 0 && formatElements[0].textContent) {
    record.format = formatElements[0].textContent.trim();
  }

  // Extract language
  const languageElements = queryDC("language");
  if (languageElements.length > 0 && languageElements[0].textContent) {
    record.language = languageElements[0].textContent.trim();
  }

  // Extract subjects
  for (const subjectElem of queryDC("subject")) {
    if (subjectElem.textContent?.trim()) {
      record.subjects.push(subjectElem.textContent.trim());
    }
  }

  // Extract identifiers (ISBN, ISSN, URL, DOI)
  for (const idElem of queryDC("identifier")) {
    if (!idElem.textContent) continue;
    const idText = idElem.textContent.trim();
    const idTextLower = idText.toLowerCase();

    if (idText.startsWith("http://") || idText.startsWith("https://")) {
      if (idTextLower.includes("doi.org/")) {
        const doiMatch = idText.match(
          /doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
        );
        if (doiMatch && !record.doi) record.doi = doiMatch[1];
      }
      if (!record.urls.includes(idText)) {
        record.urls.push(idText);
      }
    } else if (idTextLower.startsWith("isbn") || extractIsbn(idText)) {
      const isbn = extractIsbn(idText);
      if (isbn && !record.isbn) record.isbn = isbn;
    } else if (idTextLower.startsWith("issn") || extractIssn(idText)) {
      const issn = extractIssn(idText);
      if (issn && !record.issn) record.issn = issn;
    } else if (
      idTextLower.startsWith("doi:") ||
      idTextLower.startsWith("10.")
    ) {
      const doiMatch = idText.match(
        /(?:doi:)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
      );
      if (doiMatch && !record.doi) record.doi = doiMatch[1];
    }
  }

  // Extract description/abstract
  const descriptionElements = queryDC("description");
  if (descriptionElements.length > 0 && descriptionElements[0].textContent) {
    record.abstract = descriptionElements[0].textContent.trim();
  }

  // Extract source info (journal citation, "In: …" chapter host, or series)
  const sourceElements = queryDC("source");
  if (sourceElements.length > 0 && sourceElements[0].textContent) {
    const sourceText = sourceElements[0].textContent.trim();
    const journalMatch = sourceText.match(
      /^(.*?)(?:,\s*Vol\.?\s*(\d+))?(?:,\s*No\.?\s*(\d+))?(?:\s*\(([^)]+)\))?(?:,\s*pp?\.?\s*(\d+(?:-\d+)?))?$/i,
    );
    if (journalMatch) {
      const potentialJournalTitle = journalMatch[1]?.trim();
      const potentialVolume = journalMatch[2];
      const potentialIssue = journalMatch[3];
      const potentialYearInParens = journalMatch[4];
      const potentialPages = journalMatch[5];

      if (potentialVolume || potentialIssue) {
        record.journal_title = potentialJournalTitle;
        record.volume = potentialVolume;
        record.issue = potentialIssue;
        record.pages = potentialPages;
        if (!record.year && potentialYearInParens) {
          const yearMatchParens = potentialYearInParens.match(
            /\b(1\d{3}|2[01]\d{2})\b/,
          );
          if (yearMatchParens) record.year = yearMatchParens[1];
        }
      } else if (potentialJournalTitle?.match(/^in:?\s/i)) {
        record.series = potentialJournalTitle.replace(/^in:?\s/i, "").trim();
        record.pages = potentialPages;
      } else if (!record.series) {
        record.series = sourceText;
      }
    } else if (!record.series && !record.journal_title) {
      record.series = sourceText;
    }
  }

  // --- Refine Document Type ---
  if (record.journal_title && (record.volume || record.issue)) {
    record.document_type = "Journal Article";
  } else if (record.issn && !record.isbn) {
    record.document_type = "Journal";
  } else if (record.series && record.pages && !record.journal_title) {
    record.document_type = "Book Chapter";
  } else if (record.isbn) {
    record.document_type = "Book";
  } else if (record.format) {
    const formatLower = record.format.toLowerCase();
    if (formatLower.includes("article"))
      record.document_type = "Journal Article";
    else if (formatLower.includes("book")) record.document_type = "Book";
    else if (formatLower.includes("thesis")) record.document_type = "Thesis";
    else if (formatLower.includes("report")) record.document_type = "Report";
    else record.document_type = record.format;
  } else {
    record.document_type = "Unknown";
  }
  if (record.document_type && !record.format) {
    record.format = record.document_type;
  }

  return record;
}

/**
 * Parse generic/unknown metadata formats by common element names (MODS-ish
 * fallback). Extracted verbatim from OAIClient.parse_generic.
 */
export function parseOaiGeneric(
  metadataRootElement: Element,
  identifier: string,
  log: ParserLog = noopLog,
): BiblioRecord | null {
  const logPrefix = "[parseOaiGeneric]";
  if (!metadataRootElement) {
    log(
      `${logPrefix} Received null metadataRootElement for ${identifier}.`,
      "warn",
    );
    return null;
  }

  const record: BiblioRecord = {
    id: identifier,
    title: `Record ${identifier}`,
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
  };

  const query = (names: string[]) =>
    findDescendantsByLocalName(metadataRootElement, names);

  // Title
  const titleElements = query(["title", "Title"]);
  if (titleElements.length > 0 && titleElements[0].textContent) {
    record.title = titleElements[0].textContent.trim();
  }

  // Author/Creator
  for (const el of query(["creator", "author", "namePart"])) {
    const name = el.textContent?.trim();
    if (name && !record.authors.includes(name)) {
      record.authors.push(name);
    }
  }

  // Date/Year
  const dateElements = query(["date", "year", "dateIssued", "issued"]);
  if (dateElements.length > 0 && dateElements[0].textContent) {
    const yearMatch = dateElements[0].textContent
      .trim()
      .match(/\b(1\d{3}|2[01]\d{2})\b/);
    if (yearMatch) record.year = yearMatch[1];
  }

  // Publisher
  const publisherElements = query(["publisher"]);
  if (publisherElements.length > 0 && publisherElements[0].textContent) {
    record.publisher_name = publisherElements[0].textContent.trim();
  }

  // Subjects
  for (const el of query(["subject", "topic", "keyword"])) {
    const subject = el.textContent?.trim();
    if (subject && !record.subjects.includes(subject)) {
      record.subjects.push(subject);
    }
  }

  // Identifiers (URL, ISBN, ISSN, DOI)
  for (const el of query(["identifier"])) {
    const idText = el.textContent?.trim();
    if (!idText) continue;
    const idTextLower = idText.toLowerCase();
    const typeAttr = el.getAttribute("type")?.toLowerCase();

    if (idText.startsWith("http")) {
      if (!record.urls.includes(idText)) record.urls.push(idText);
    } else if (typeAttr === "isbn" || idTextLower.startsWith("isbn")) {
      const isbn = extractIsbn(idText);
      if (isbn && !record.isbn) record.isbn = isbn;
    } else if (typeAttr === "issn" || idTextLower.startsWith("issn")) {
      const issn = extractIssn(idText);
      if (issn && !record.issn) record.issn = issn;
    } else if (
      typeAttr === "doi" ||
      idTextLower.startsWith("doi:") ||
      idTextLower.startsWith("10.")
    ) {
      const doiMatch = idText.match(
        /(?:doi:)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
      );
      if (doiMatch && !record.doi) record.doi = doiMatch[1];
    }
  }
  // Also check specific URL elements
  for (const el of query(["url", "link", "relatedLink"])) {
    const text = el.textContent?.trim();
    if (text && text.startsWith("http")) {
      if (!record.urls.includes(text)) record.urls.push(text);
    } else if (el.getAttribute("href")?.startsWith("http")) {
      const url = el.getAttribute("href")!;
      if (!record.urls.includes(url)) record.urls.push(url);
    }
  }

  // Abstract/Description
  const abstractElements = query(["abstract", "description", "note"]);
  if (abstractElements.length > 0 && abstractElements[0].textContent) {
    record.abstract = abstractElements[0].textContent.trim();
  }

  // Language
  const languageElements = query(["language", "languageTerm"]);
  if (languageElements.length > 0 && languageElements[0].textContent) {
    record.language = languageElements[0].textContent.trim();
  }

  // Format/Type
  const formatElements = query(["format", "type", "genre"]);
  if (formatElements.length > 0 && formatElements[0].textContent) {
    record.format = formatElements[0].textContent.trim();
    record.document_type = record.format;
  }

  return record;
}

/**
 * Process an OAI <record> element into a BiblioRecord (or null for deleted /
 * unparseable records — those must not surface as importable junk items).
 * Extracted verbatim from OAIClient.process_record_element.
 */
export function processOaiRecordElement(
  recordElement: Element,
  metadataPrefix: string,
  log: ParserLog = noopLog,
): BiblioRecord | null {
  const logPrefix = "[processOaiRecordElement]";
  try {
    const header = firstDescendantByLocalName(recordElement, "header");
    const identifierElement = header
      ? firstDescendantByLocalName(header, "identifier")
      : null;
    const identifier = identifierElement?.textContent?.trim() || "unknown";

    // Deleted records must not be imported as items.
    if (header?.getAttribute("status") === "deleted") {
      log(`${logPrefix} Skipping deleted record ${identifier}.`, "warn");
      return null;
    }

    const metadataElement = firstDescendantByLocalName(
      recordElement,
      "metadata",
    );
    if (!metadataElement) {
      log(
        `${logPrefix} Record ${identifier} has no <metadata> element.`,
        "warn",
      );
      return null;
    }

    // The actual metadata is the first child of <metadata>.
    const actualMetadataRoot = firstChildElement(metadataElement);
    if (!actualMetadataRoot) {
      log(
        `${logPrefix} Record ${identifier} has empty <metadata> element.`,
        "warn",
      );
      return null;
    }

    // Parse based on the *requested* prefix, assuming the server complied.
    let parsedRecord: BiblioRecord | null;
    log(
      `${logPrefix} Parsing record ${identifier} using prefix: ${metadataPrefix}`,
    );
    if (metadataPrefix === "oai_dc" || metadataPrefix === "dc") {
      parsedRecord = parseOaiDublinCore(actualMetadataRoot, identifier, log);
    } else {
      log(
        `${logPrefix} No specific parser for '${metadataPrefix}'. Using generic fallback.`,
        "warn",
      );
      parsedRecord = parseOaiGeneric(actualMetadataRoot, identifier, log);
    }

    // Attach the raw metadata XML for re-export where a serializer exists
    // (Zotero window / browser; absent under @xmldom in tests).
    if (parsedRecord) {
      parsedRecord.schema = metadataPrefix;
      const Serializer = (
        globalThis as { XMLSerializer?: new () => XMLSerializer }
      ).XMLSerializer;
      if (Serializer) {
        try {
          parsedRecord.raw_data = new Serializer().serializeToString(
            actualMetadataRoot,
          );
        } catch (e: any) {
          log(
            `${logPrefix} Error serializing raw XML for ${identifier}: ${e.message}`,
            "error",
          );
          parsedRecord.raw_data = "Error serializing raw data";
        }
      }
    }

    return parsedRecord;
  } catch (e: any) {
    log(`${logPrefix} Error processing record element: ${e.message}`, "error");
    return null; // a parse error must not surface as an importable junk item
  }
}
