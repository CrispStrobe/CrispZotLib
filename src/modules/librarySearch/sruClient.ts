// src/modules/librarySearch/sruClient.ts - SRU protocol client implementation

import { BiblioRecord } from "./models";
import { NAMESPACES } from "./endpoints";
import { fetchWithTimeout, readXml } from "./httpUtils";
import {
  parseSruDublinCore,
  parseSruGeneric,
  parseSruRdfXml,
} from "./sruRecordParser";

// cleanPersonName moved to the pure sruRecordParser module (PLAN 7.4); re-export
// so existing importers (tests, callers) keep working.
export { cleanPersonName } from "./sruRecordParser";

// Helper function to escape special characters in a query string
export function escapeQueryString(query: string): string {
  return encodeURIComponent(query)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
    .replace(/%20/g, "+");
}

/** Fast lookups over a single MARCXML record. */
export interface MarcIndex {
  /** Datafield elements for a tag, optionally filtered by first indicator. */
  getFields(tag: string, ind1?: string): Element[];
  /** Trimmed text of every matching subfield across all fields of `tag`. */
  getData(tag: string, code: string): string[];
  /** First subfield element with `code` inside `field`, or null. */
  getSub(field: Element, code: string): Element | null;
  /** The record's leader text, or null. */
  leader: string | null;
}

/**
 * Build a one-pass index of a MARCXML record's datafields/subfields.
 *
 * The previous approach called `doc.evaluate('.//*[local-name()=…]')` — a full
 * subtree scan — on every one of the ~30 field lookups per record, re-walking
 * the whole record each time. This walks it once: all datafields are grouped by
 * tag up front, subfields are read from each field's direct children on first
 * access and cached. It is also namespace-agnostic (via `getElementsByTagNameNS`
 * and `localName`) and free of `doc.evaluate`, so it is unit-testable offline.
 *
 * @param element          The MARCXML record element (marc:record / recordData).
 * @param elementNodeType  `Node.ELEMENT_NODE` from the host DOM.
 */
export function indexMarcRecord(
  element: Element,
  elementNodeType: number,
): MarcIndex {
  const fieldsByTag = new Map<string, Element[]>();
  const datafields = element.getElementsByTagNameNS("*", "datafield");
  for (let i = 0; i < datafields.length; i++) {
    const f = datafields[i];
    const tag = f.getAttribute("tag");
    if (!tag) continue;
    const arr = fieldsByTag.get(tag);
    if (arr) arr.push(f);
    else fieldsByTag.set(tag, [f]);
  }

  // Subfield maps are computed lazily per field and cached (a field's subfields
  // are often read under several codes, e.g. 245$a then 245$b).
  const subCache = new Map<Element, Map<string, Element[]>>();
  const subfieldsOf = (field: Element): Map<string, Element[]> => {
    const cached = subCache.get(field);
    if (cached) return cached;
    const m = new Map<string, Element[]>();
    const kids = field.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i] as unknown as Element;
      if (n.nodeType === elementNodeType && n.localName === "subfield") {
        const code = n.getAttribute("code");
        if (code == null) continue;
        const arr = m.get(code);
        if (arr) arr.push(n);
        else m.set(code, [n]);
      }
    }
    subCache.set(field, m);
    return m;
  };

  const leaderEls = element.getElementsByTagNameNS("*", "leader");
  const leader = leaderEls.length ? (leaderEls[0].textContent ?? null) : null;

  return {
    getFields(tag: string, ind1?: string): Element[] {
      const fs = fieldsByTag.get(tag) ?? [];
      return ind1
        ? fs.filter((f) => f.getAttribute("ind1") === ind1)
        : fs.slice();
    },
    getData(tag: string, code: string): string[] {
      const out: string[] = [];
      for (const f of fieldsByTag.get(tag) ?? []) {
        for (const sf of subfieldsOf(f).get(code) ?? []) {
          if (sf.textContent) out.push(sf.textContent.trim());
        }
      }
      return out;
    },
    getSub(field: Element, code: string): Element | null {
      return subfieldsOf(field).get(code)?.[0] ?? null;
    },
    leader,
  };
}

// SRU Client class
export class SRUClient {
  // Public getter for baseUrl
  public get baseUrl(): string {
    return this._baseUrl;
  }

  private defaultSchema?: string;
  private version: string;
  private timeout: number;
  private namespaces: Record<string, string>;
  private queryParams: Record<string, string>;

  /**
   * Create a new SRU client
   */
  constructor(
    private readonly _baseUrl: string,
    private readonly _defaultSchema?: string,
    private readonly _version: string = "1.1",
    private readonly _timeout: number = 30000,
    private readonly _namespaces?: Record<string, string>,
    private readonly _queryParams?: Record<string, string>,
  ) {
    this.namespaces = { ...NAMESPACES, ...(_namespaces || {}) };
    this.queryParams = _queryParams || {};
    this.version = _version;
    this.timeout = _timeout;
    this.defaultSchema = _defaultSchema;
  }

  /**
   * Build a complete SRU query URL
   */
  buildQueryUrl(
    query: string,
    schema?: string,
    maxRecords: number = 10,
    startRecord: number = 1,
  ): string {
    const actualSchema = schema || this.defaultSchema;
    ztoolkit.log(`[SRUClient.buildQueryUrl] Base URL: ${this.baseUrl}`);

    const params: Record<string, string> = {
      version: this.version,
      operation: "searchRetrieve",
      query: query,
      maximumRecords: maxRecords.toString(),
      startRecord: startRecord.toString(),
    };
    if (actualSchema) params["recordSchema"] = actualSchema;

    let customSuffix = "";
    const standardParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.queryParams)) {
      if (key.toLowerCase() === "suffix") {
        customSuffix = value;
        ztoolkit.log(
          `[SRUClient.buildQueryUrl] Found custom suffix: ${customSuffix}`,
        );
      } else {
        standardParams[key] = value;
      }
    }
    Object.assign(params, standardParams);
    ztoolkit.log(
      `[SRUClient.buildQueryUrl] Standard Params (base + extra): ${JSON.stringify(params)}`,
    );

    const paramString = Object.entries(params)
      .map(([key, value]) => `${key}=${escapeQueryString(value)}`)
      .join("&");
    ztoolkit.log(
      `[SRUClient.buildQueryUrl] Constructed Param String: ${paramString}`,
    );

    let finalUrl = this.baseUrl.includes("?")
      ? `${this.baseUrl}&${paramString}`
      : `${this.baseUrl}?${paramString}`;

    if (customSuffix) {
      const separator = finalUrl.includes("?") ? "&" : "?";
      if (!customSuffix.startsWith("&") && !customSuffix.startsWith("?")) {
        finalUrl +=
          separator +
          customSuffix.substring(customSuffix.startsWith("/") ? 1 : 0);
      } else {
        finalUrl += customSuffix;
      }
      ztoolkit.log(`[SRUClient.buildQueryUrl] Appended custom suffix.`);
    }

    ztoolkit.log(`[SRUClient.buildQueryUrl] Final URL: ${finalUrl}`);
    return finalUrl;
  }

  /**
   * Creates a namespace resolver function for document.evaluate.
   */
  private createNsResolver(doc: Document): XPathNSResolver {
    const nsMap = this.namespaces;
    const defaultNS = doc.documentElement?.namespaceURI ?? null;
    return {
      lookupNamespaceURI: function (prefix: string | null): string | null {
        if (!prefix) return defaultNS;
        return nsMap[prefix] || null;
      },
    };
  }

  /**
   * Execute an SRU search query and return parsed BiblioRecord objects
   * Accepts DOM capabilities.
   * CORRECTED SIGNATURE: Required DOM params before optional SRU params.
   */
  async search(
    query: string,
    // --- Required DOM capabilities FIRST ---
    domParserConst: typeof DOMParser,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
    xmlSerializerConst: typeof XMLSerializer,
    // --- Optional SRU parameters ---
    schema?: string,
    maxRecords: number = 10,
    startRecord: number = 1,
  ): Promise<[number, BiblioRecord[]]> {
    try {
      const url = this.buildQueryUrl(query, schema, maxRecords, startRecord);
      ztoolkit.log(`Executing SRU query: ${url}`);

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/xml" } },
        this.timeout,
        2,
      );
      if (!response.ok)
        throw new Error(
          `SRU request failed: ${response.status} ${response.statusText}`,
        );

      const xmlText = await readXml(response); // charset-aware (PLAN 2.12)
      const parser = new domParserConst(); // Use passed DOMParser
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");

      // Detect malformed XML: DOMParser yields a document containing a
      // <parsererror> element rather than throwing. Without this, a truncated or
      // invalid response is indistinguishable from a legitimate empty result.
      const parseErrors = xmlDoc.getElementsByTagName("parsererror");
      if (parseErrors && parseErrors.length > 0) {
        ztoolkit.log(
          `SRU response was not well-formed XML: ${(parseErrors[0].textContent || "").slice(0, 200)}`,
          "error",
        );
        return [0, []];
      }

      const diagnostics = this.checkForDiagnostics(
        xmlDoc,
        nodeConst,
        xpathResultConst,
      );
      if (diagnostics.length > 0) {
        ztoolkit.log(
          `SRU diagnostics found: ${diagnostics.join("; ")}`,
          "warn",
        );
        if (
          this.baseUrl.includes("catalogue.bnf.fr") &&
          schema === "marcxchange" &&
          diagnostics.some((d) => d.includes("schema"))
        ) {
          ztoolkit.log("Retrying BNF query with dublincore schema");
          // Recursive call passes DOM capabilities along
          return this.search(
            query,
            domParserConst, // Pass required DOM capabilities
            nodeConst,
            xpathResultConst,
            xmlSerializerConst,
            "dublincore", // New schema (optional param)
            maxRecords, // Pass original maxRecords (optional param)
            startRecord, // Pass original startRecord (optional param)
          );
        }
      }

      const numberOfRecordsElement = this.findElement(
        xmlDoc,
        ".//srw:numberOfRecords",
        nodeConst,
        xpathResultConst,
      );
      const totalRecords = numberOfRecordsElement
        ? parseInt(numberOfRecordsElement.textContent || "0", 10)
        : 0;
      ztoolkit.log(`Found ${totalRecords} total records`);

      if (totalRecords === 0) return [0, []];

      const records: BiblioRecord[] = [];
      const recordElements = this.findElements(
        xmlDoc,
        ".//srw:record",
        nodeConst,
        xpathResultConst,
      );

      for (const recordElement of recordElements) {
        try {
          const schemaElement = this.findElement(
            recordElement,
            ".//srw:recordSchema",
            nodeConst,
            xpathResultConst,
          );
          const recordSchema =
            schemaElement?.textContent?.trim() || schema || this.defaultSchema;
          const recordDataElement = this.findElement(
            recordElement,
            ".//srw:recordData",
            nodeConst,
            xpathResultConst,
          );
          if (!recordDataElement) continue;

          const recordIdElement = this.findElement(
            recordElement,
            ".//srw:recordIdentifier",
            nodeConst,
            xpathResultConst,
          );
          const positionElement = this.findElement(
            recordElement,
            ".//srw:recordPosition",
            nodeConst,
            xpathResultConst,
          );
          const recordId =
            recordIdElement?.textContent ||
            positionElement?.textContent ||
            `record-${records.length + 1}`;

          const serializer = new xmlSerializerConst(); // Use passed XMLSerializer
          const rawXml = serializer.serializeToString(recordDataElement);

          // Pass Node/XPathResult to parseRecord
          const record = this.parseRecord(
            recordDataElement,
            recordId,
            recordSchema,
            rawXml,
            nodeConst,
            xpathResultConst,
          );
          if (record) records.push(record);
        } catch (e: any) {
          ztoolkit.log(`Error parsing record: ${e.message}`, "error");
        }
      }
      return [totalRecords, records];
    } catch (e: any) {
      ztoolkit.log(`SRU search error: ${e.message}`, "error");
      ztoolkit.log(`Stack: ${e.stack}`, "error");
      return [0, []];
    }
  }

  /**
   * Check for diagnostic messages in the SRU response
   * Accepts Node/XPathResult
   */
  private checkForDiagnostics(
    xmlDoc: Document,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
  ): string[] {
    const diagnosticMessages: string[] = [];
    const processDiagnostics = (xpath: string) => {
      const diagnostics = this.findElements(
        xmlDoc,
        xpath,
        nodeConst,
        xpathResultConst,
      );
      for (const diag of diagnostics) {
        const messageElem = this.findElement(
          diag,
          "./sd:message",
          nodeConst,
          xpathResultConst,
        );
        const detailsElem = this.findElement(
          diag,
          "./sd:details",
          nodeConst,
          xpathResultConst,
        );
        if (messageElem?.textContent)
          diagnosticMessages.push(messageElem.textContent.trim());
        if (detailsElem?.textContent)
          diagnosticMessages.push(detailsElem.textContent.trim());
      }
    };
    processDiagnostics(".//sd:diagnostic"); // BNF-specific
    processDiagnostics(".//srw:diagnostics/sd:diagnostic"); // Standard SRU
    return diagnosticMessages;
  }

  /**
   * Parse a record based on its schema
   * Accepts Node/XPathResult
   */
  private parseRecord(
    recordDataElement: Element,
    recordId: string,
    schema: string | undefined,
    rawXml: string | undefined,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
  ): BiblioRecord | null {
    try {
      switch (schema) {
        case "dublincore":
        case "dc":
        case "info:srw/schema/1/dc-v1.1":
          return parseSruDublinCore(
            recordDataElement,
            recordId,
            rawXml,
            this.namespaces,
          );
        case "marcxml":
        case "MARC21-xml":
        case "info:srw/schema/1/marcxml-v1.1":
          return this.parseMarcXml(
            recordDataElement,
            recordId,
            rawXml,
            nodeConst,
            xpathResultConst,
          );
        case "RDFxml":
          return parseSruRdfXml(
            recordDataElement,
            recordId,
            rawXml,
            this.namespaces,
          );
        default:
          ztoolkit.log(
            `Parsing record ${recordId} with generic parser (schema: ${schema || "unknown"})`,
            "warn",
          );
          return parseSruGeneric(
            recordDataElement,
            recordId,
            rawXml,
            this.namespaces,
          );
      }
    } catch (e: any) {
      ztoolkit.log(
        `Error parsing record ${recordId} (schema: ${schema}): ${e.message}`,
        "error",
      );
      return {
        id: recordId,
        title: `Error parsing record ${recordId}`,
        authors: [],
        editors: [],
        translators: [],
        contributors: [],
        urls: [],
        subjects: [],
        raw_data: rawXml,
        schema: schema,
      };
    }
  }

  /**
   * Parse MARCXML formatted records
   * Accepts Node/XPathResult
   */
  private parseMarcXml(
    element: Element,
    recordId: string,
    rawXml: string | undefined,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
  ): BiblioRecord {
    const record: BiblioRecord = {
      id: recordId,
      title: "Untitled",
      authors: [],
      editors: [],
      translators: [],
      contributors: [],
      urls: [],
      subjects: [],
      raw_data: rawXml,
      schema: "marcxml",
    };
    // One-pass index of the record's datafields/subfields — avoids re-scanning
    // the whole subtree on each of the ~30 field lookups below.
    const marc = indexMarcRecord(element, nodeConst.ELEMENT_NODE);
    const findData = (tag: string, code: string) => marc.getData(tag, code);
    const findFields = (tag: string, ind1?: string) =>
      marc.getFields(tag, ind1);
    const findSub = (field: Element, code: string) => marc.getSub(field, code);
    const findLead = () => marc.leader;
    const seenNames = new Set<string>();

    let title =
      findData("245", "a")[0]?.replace(/[/:]$/, "").trim() || "Untitled";
    const subtitle = findData("245", "b")[0]?.trim();
    if (subtitle) title += `: ${subtitle}`;
    record.title = title;

    const processFieldNames = (fields: Element[], defaultRole: string) => {
      for (const field of fields) {
        const name = findSub(field, "a")?.textContent?.trim();
        if (!name) continue;
        const roleText = findSub(field, "e")?.textContent?.trim().toLowerCase();
        let role = defaultRole;
        let cleanName = name;
        if (roleText) {
          if (/edit|hrsg|hg/.test(roleText)) role = "editor";
          else if (/transl|übers/.test(roleText)) role = "translator";
          // Author relator terms across languages (DNB/K10plus use "Verfasser").
          // Without this, a primary 100 $e="Verfasser" was mis-filed as a
          // contributor with role "verfasser" instead of an author.
          else if (/verf|author|autor|creator/.test(roleText)) role = "author";
          else role = roleText;
        }
        cleanName = cleanName.replace(/[,.;]$/, "").trim();
        if (!cleanName || seenNames.has(cleanName)) continue;
        seenNames.add(cleanName);
        if (role === "editor") record.editors.push(cleanName);
        else if (role === "translator") record.translators.push(cleanName);
        else if (role === "author") record.authors.push(cleanName);
        else record.contributors.push({ name: cleanName, role });
      }
    };

    processFieldNames(findFields("100"), "author");
    processFieldNames(findFields("700"), "author");

    for (const tag of ["260", "264"]) {
      record.year =
        record.year ||
        findData(tag, "c")[0]?.match(/\b(1\d{3}|20\d{2})\b/)?.[1];
      record.publisher_name =
        record.publisher_name ||
        findData(tag, "b")[0]?.replace(/[,:]$/, "").trim();
      record.place_of_publication =
        record.place_of_publication ||
        findData(tag, "a")[0]?.replace(/:$/, "").trim();
    }
    record.isbn =
      findData("020", "a")[0]?.match(/(\d[\d\-X]+)/)?.[1] ||
      findData("020", "a")[0];
    record.issn = findData("022", "a")[0];
    findFields("024", "7").forEach((field) => {
      if (findSub(field, "2")?.textContent?.trim().toLowerCase() === "doi") {
        record.doi = findSub(field, "a")?.textContent?.trim();
      }
    });
    for (const tag of ["650", "651", "653"]) {
      findData(tag, "a").forEach((s) => {
        if (!record.subjects.includes(s)) record.subjects.push(s);
      });
    }
    // DDC (082) / other classification (084) as subject tags
    findData("082", "a").forEach((c) => {
      const t = `DDC:${c}`;
      if (!record.subjects.includes(t)) record.subjects.push(t);
    });
    findData("084", "a").forEach((c) => {
      if (!record.subjects.includes(c)) record.subjects.push(c);
    });
    // Abstract / summary (520)
    record.abstract =
      record.abstract || findData("520", "a").join(" ").trim() || undefined;
    // Corporate authors (110 main / 710 added) as single-field names
    findData("110", "a").forEach((n) => {
      const name = n.replace(/[,.;]$/, "").trim();
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        record.authors.push(name);
      }
    });
    findData("710", "a").forEach((n) => {
      const name = n.replace(/[,.;]$/, "").trim();
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        record.contributors.push({ name, role: "corporate" });
      }
    });
    record.language = findData("041", "a")[0];
    record.series = findData("490", "a")[0] || findData("830", "a")[0];
    record.extent = findData("300", "a")[0];
    if (record.extent) {
      const pm = record.extent.match(
        /(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:p|pages|S)/i,
      );
      if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1];
    }
    record.edition = findData("250", "a")[0];
    record.urls = findData("856", "u");

    findFields("773").forEach((field) => {
      const hostTitle = findSub(field, "t")?.textContent?.trim();
      if (!hostTitle) return;
      const volText = findSub(field, "g")?.textContent?.trim() || "";
      const link7 = findSub(field, "7")?.textContent?.trim() || "";
      const hostIssn = findSub(field, "x")?.textContent?.trim(); // 773$x = host ISSN
      // Decide journal-vs-chapter by the host's bibliographic level in 773$7 position 3
      // ('s' = serial -> journal, 'm' = monograph -> chapter). Fall back to sniffing
      // $g for volume/issue markers in BOTH English and German (K10plus uses forms like
      // "78(2024), 3, Seite 205-213" that carry no vol/no keyword at all).
      const hostBibLevel = link7.length >= 4 ? link7[3].toLowerCase() : "";
      let isJournal: boolean;
      if (hostBibLevel === "s") isJournal = true;
      else if (hostBibLevel === "m") isJournal = false;
      else
        isJournal =
          /vol|issue|no\.?|nr\.?|number|band|bd\.?|jg\.?|jahrg|heft|\(\d{4}\)/i.test(
            volText,
          );

      if (isJournal) {
        // Type is decided authoritatively by the leader below; here we only
        // record the host as the journal and pull volume/issue/pages/ISSN.
        record.journal_title = hostTitle;
        if (hostIssn && !record.issn) record.issn = hostIssn;
        record.volume =
          volText.match(
            /(?:vol(?:ume)?|bd\.?|band|jg\.?|jahrg(?:ang)?)\.?\s*(\d+)/i,
          )?.[1] ||
          volText.match(/(\d+)\s*\(\d{4}\)/)?.[1] || // "78(2024)"
          volText.match(/^\s*(\d+)\b/)?.[1] ||
          record.volume;
        record.issue =
          volText.match(/(?:no|nr|issue|num|heft|h)\.?\s*(\d+)/i)?.[1] ||
          volText.match(/\)\s*,\s*(\d+)/)?.[1] || // "…(2024), 3,"
          record.issue;
        const pm = volText.match(
          /\b(?:seite|pages?|pp?|s)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/i,
        );
        if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1];
      } else {
        record.series = hostTitle;
      }
    });

    // Document type — the leader is authoritative (position 6 = material type,
    // position 7 = bibliographic level). Non-text material wins; otherwise the
    // bibliographic level decides monograph/serial/component.
    const leader = findLead();
    const materialType = leader && leader.length >= 8 ? leader[6] : "";
    const biblioLevel = leader && leader.length >= 8 ? leader[7] : "";
    const NONTEXT: Record<string, string> = {
      c: "Score",
      d: "Score",
      e: "Map",
      f: "Map",
      g: "Video",
      i: "Audio Recording",
      j: "Music",
      k: "Image",
      m: "Computer File",
      o: "Kit",
      r: "Object",
    };
    if (NONTEXT[materialType]) {
      record.document_type = NONTEXT[materialType];
    } else if (biblioLevel === "m") {
      record.document_type = "Book";
    } // monograph (even in a series)
    else if (biblioLevel === "s") {
      record.document_type = "Journal";
    } // the serial itself
    else if (biblioLevel === "a" || biblioLevel === "b") {
      // component part
      record.document_type = record.journal_title
        ? "Journal Article"
        : "Book Chapter";
    } else if (biblioLevel === "c") {
      record.document_type = "Book";
    } // collection
    if (!record.document_type) {
      // Fallback when the leader is missing/uninformative
      if (record.journal_title) {
        record.document_type = "Journal Article";
      } else if (record.isbn) {
        record.document_type = "Book";
      } else if (record.issn) {
        record.document_type = "Journal";
      } else {
        record.document_type = "Book";
      }
    }
    record.format = record.document_type;
    return record;
  }

  /**
   * Helper method to find a single XML element using XPath.
   * Accepts Node/XPathResult
   */
  private findElement(
    contextNode: Document | Element,
    xpath: string,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
  ): Element | null {
    try {
      const doc = contextNode.ownerDocument || (contextNode as Document);
      if (!doc.evaluate) {
        ztoolkit.log("doc.evaluate not found.", "error");
        return null;
      }
      const nsResolver = this.createNsResolver(doc);
      const result = doc.evaluate(
        xpath,
        contextNode,
        nsResolver,
        xpathResultConst.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      if (
        result.singleNodeValue &&
        result.singleNodeValue.nodeType === nodeConst.ELEMENT_NODE
      ) {
        return result.singleNodeValue as Element;
      }
      return null;
    } catch (e: any) {
      ztoolkit.log(`Error evaluating XPath "${xpath}": ${e.message}`, "error");
      return null;
    }
  }

  /**
   * Helper method to find multiple XML elements using XPath.
   * Accepts Node/XPathResult
   */
  private findElements(
    contextNode: Document | Element,
    xpath: string,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
  ): Element[] {
    const elements: Element[] = [];
    try {
      const doc = contextNode.ownerDocument || (contextNode as Document);
      if (!doc.evaluate) {
        ztoolkit.log("doc.evaluate not found.", "error");
        return [];
      }
      const nsResolver = this.createNsResolver(doc);
      const iterator = doc.evaluate(
        xpath,
        contextNode,
        nsResolver,
        xpathResultConst.ORDERED_NODE_ITERATOR_TYPE,
        null,
      );
      let node = iterator.iterateNext();
      while (node) {
        if (node.nodeType === nodeConst.ELEMENT_NODE) {
          elements.push(node as Element);
        }
        node = iterator.iterateNext();
      }
    } catch (e: any) {
      ztoolkit.log(
        `Error evaluating XPath iterator "${xpath}": ${e.message}`,
        "error",
      );
    }
    return elements;
  }
} // End SRUClient
