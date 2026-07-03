// src/modules/librarySearch/sruClient.ts - SRU protocol client implementation

import { BiblioRecord } from './models';
import { NAMESPACES } from './endpoints';
import { fetchWithTimeout } from './httpUtils';

// Helper function to escape special characters in a query string
export function escapeQueryString(query: string): string {
  return encodeURIComponent(query)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+');
}

// Strip life dates and role phrases that DC/RDF sources (esp. BnF) append to
// creator names, e.g. "Habermas, Jürgen (1929-2026). Auteur du texte".
export function cleanPersonName(name: string): string {
  if (!name) return name;
  let n = name.trim();
  n = n.replace(/\.\s*(?:Auteur|[ÉE]diteur|Traducteur|Pr[ée]facier|Collaborateur|Illustrateur|Annotateur|Directeur|Author|Editor|Translator|Contributor)[^.]*$/i, '');
  n = n.replace(/\s*\(\s*\d{3,4}\s*-\s*\d{0,4}\.?\s*\)\s*$/, '');
  n = n.replace(/,?\s*\d{4}\s*-\s*\d{0,4}\s*$/, '');
  return n.trim().replace(/,\s*$/, '').trim();
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
export function indexMarcRecord(element: Element, elementNodeType: number): MarcIndex {
  const fieldsByTag = new Map<string, Element[]>();
  const datafields = element.getElementsByTagNameNS('*', 'datafield');
  for (let i = 0; i < datafields.length; i++) {
    const f = datafields[i];
    const tag = f.getAttribute('tag');
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
      if (n.nodeType === elementNodeType && n.localName === 'subfield') {
        const code = n.getAttribute('code');
        if (code == null) continue;
        const arr = m.get(code);
        if (arr) arr.push(n);
        else m.set(code, [n]);
      }
    }
    subCache.set(field, m);
    return m;
  };

  const leaderEls = element.getElementsByTagNameNS('*', 'leader');
  const leader = leaderEls.length ? (leaderEls[0].textContent ?? null) : null;

  return {
    getFields(tag: string, ind1?: string): Element[] {
      const fs = fieldsByTag.get(tag) ?? [];
      return ind1 ? fs.filter((f) => f.getAttribute('ind1') === ind1) : fs.slice();
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
      private readonly _queryParams?: Record<string, string>
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
    startRecord: number = 1
  ): string {
    const actualSchema = schema || this.defaultSchema;
    ztoolkit.log(`[SRUClient.buildQueryUrl] Base URL: ${this.baseUrl}`);

    const params: Record<string, string> = {
      'version': this.version,
      'operation': 'searchRetrieve',
      'query': query,
      'maximumRecords': maxRecords.toString(),
      'startRecord': startRecord.toString()
    };
    if (actualSchema) params['recordSchema'] = actualSchema;

    let customSuffix = '';
    const standardParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.queryParams)) {
        if (key.toLowerCase() === 'suffix') {
            customSuffix = value;
            ztoolkit.log(`[SRUClient.buildQueryUrl] Found custom suffix: ${customSuffix}`);
        } else { standardParams[key] = value; }
    }
    Object.assign(params, standardParams);
    ztoolkit.log(`[SRUClient.buildQueryUrl] Standard Params (base + extra): ${JSON.stringify(params)}`);

    const paramString = Object.entries(params)
      .map(([key, value]) => `${key}=${escapeQueryString(value)}`)
      .join('&');
    ztoolkit.log(`[SRUClient.buildQueryUrl] Constructed Param String: ${paramString}`);

    let finalUrl = this.baseUrl.includes('?') ? `${this.baseUrl}&${paramString}` : `${this.baseUrl}?${paramString}`;

    if (customSuffix) {
        const separator = finalUrl.includes('?') ? '&' : '?';
        if (!customSuffix.startsWith('&') && !customSuffix.startsWith('?')) {
             finalUrl += separator + customSuffix.substring(customSuffix.startsWith('/') ? 1 : 0);
        } else { finalUrl += customSuffix; }
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
        lookupNamespaceURI: function(prefix: string | null): string | null {
            if (!prefix) return defaultNS;
            return nsMap[prefix] || null;
        }
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
    startRecord: number = 1
  ): Promise<[number, BiblioRecord[]]> {
    try {
      const url = this.buildQueryUrl(query, schema, maxRecords, startRecord);
      ztoolkit.log(`Executing SRU query: ${url}`);

      const response = await fetchWithTimeout(
        url,
        { method: 'GET', headers: { 'Accept': 'application/xml' } },
        this.timeout,
        2,
      );
      if (!response.ok) throw new Error(`SRU request failed: ${response.status} ${response.statusText}`);

      const xmlText = await response.text();
      const parser = new domParserConst(); // Use passed DOMParser
      const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

      // Detect malformed XML: DOMParser yields a document containing a
      // <parsererror> element rather than throwing. Without this, a truncated or
      // invalid response is indistinguishable from a legitimate empty result.
      const parseErrors = xmlDoc.getElementsByTagName('parsererror');
      if (parseErrors && parseErrors.length > 0) {
        ztoolkit.log(`SRU response was not well-formed XML: ${(parseErrors[0].textContent || '').slice(0, 200)}`, 'error');
        return [0, []];
      }

      const diagnostics = this.checkForDiagnostics(xmlDoc, nodeConst, xpathResultConst);
      if (diagnostics.length > 0) {
        ztoolkit.log(`SRU diagnostics found: ${diagnostics.join('; ')}`, 'warn');
        if (this.baseUrl.includes('catalogue.bnf.fr') && schema === 'marcxchange' && diagnostics.some(d => d.includes('schema'))) {
          ztoolkit.log("Retrying BNF query with dublincore schema");
          // Recursive call passes DOM capabilities along
          return this.search(
            query,
            domParserConst,     // Pass required DOM capabilities
            nodeConst,
            xpathResultConst,
            xmlSerializerConst,
            'dublincore',       // New schema (optional param)
            maxRecords,         // Pass original maxRecords (optional param)
            startRecord         // Pass original startRecord (optional param)
        );
        }
      }

      const numberOfRecordsElement = this.findElement(xmlDoc, './/srw:numberOfRecords', nodeConst, xpathResultConst);
      const totalRecords = numberOfRecordsElement ? parseInt(numberOfRecordsElement.textContent || '0', 10) : 0;
      ztoolkit.log(`Found ${totalRecords} total records`);

      if (totalRecords === 0) return [0, []];

      const records: BiblioRecord[] = [];
      const recordElements = this.findElements(xmlDoc, './/srw:record', nodeConst, xpathResultConst);

      for (const recordElement of recordElements) {
        try {
          const schemaElement = this.findElement(recordElement, './/srw:recordSchema', nodeConst, xpathResultConst);
          const recordSchema = schemaElement?.textContent?.trim() || schema || this.defaultSchema;
          const recordDataElement = this.findElement(recordElement, './/srw:recordData', nodeConst, xpathResultConst);
          if (!recordDataElement) continue;

          const recordIdElement = this.findElement(recordElement, './/srw:recordIdentifier', nodeConst, xpathResultConst);
          const positionElement = this.findElement(recordElement, './/srw:recordPosition', nodeConst, xpathResultConst);
          const recordId = recordIdElement?.textContent || positionElement?.textContent || `record-${records.length + 1}`;

          const serializer = new xmlSerializerConst(); // Use passed XMLSerializer
          const rawXml = serializer.serializeToString(recordDataElement);

          // Pass Node/XPathResult to parseRecord
          const record = this.parseRecord(recordDataElement, recordId, recordSchema, rawXml, nodeConst, xpathResultConst);
          if (record) records.push(record);

        } catch (e: any) { ztoolkit.log(`Error parsing record: ${e.message}`, 'error'); }
      }
      return [totalRecords, records];
    } catch (e: any) {
      ztoolkit.log(`SRU search error: ${e.message}`, 'error');
      ztoolkit.log(`Stack: ${e.stack}`, 'error');
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
      xpathResultConst: typeof XPathResult
  ): string[] {
    const diagnosticMessages: string[] = [];
    const processDiagnostics = (xpath: string) => {
        const diagnostics = this.findElements(xmlDoc, xpath, nodeConst, xpathResultConst);
        for (const diag of diagnostics) {
            const messageElem = this.findElement(diag, './sd:message', nodeConst, xpathResultConst);
            const detailsElem = this.findElement(diag, './sd:details', nodeConst, xpathResultConst);
            if (messageElem?.textContent) diagnosticMessages.push(messageElem.textContent.trim());
            if (detailsElem?.textContent) diagnosticMessages.push(detailsElem.textContent.trim());
        }
    };
    processDiagnostics('.//sd:diagnostic'); // BNF-specific
    processDiagnostics('.//srw:diagnostics/sd:diagnostic'); // Standard SRU
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
    xpathResultConst: typeof XPathResult
  ): BiblioRecord | null {
    try {
      switch(schema) {
        case 'dublincore': case 'dc': case 'info:srw/schema/1/dc-v1.1':
          return this.parseDublinCore(recordDataElement, recordId, rawXml, nodeConst, xpathResultConst);
        case 'marcxml': case 'MARC21-xml': case 'info:srw/schema/1/marcxml-v1.1':
          return this.parseMarcXml(recordDataElement, recordId, rawXml, nodeConst, xpathResultConst);
        case 'RDFxml':
          return this.parseRdfXml(recordDataElement, recordId, rawXml, nodeConst, xpathResultConst);
        default:
          ztoolkit.log(`Parsing record ${recordId} with generic parser (schema: ${schema || 'unknown'})`, 'warn');
          return this.parseGeneric(recordDataElement, recordId, rawXml, nodeConst, xpathResultConst);
      }
    } catch (e: any) {
      ztoolkit.log(`Error parsing record ${recordId} (schema: ${schema}): ${e.message}`, 'error');
      return { id: recordId, title: `Error parsing record ${recordId}`, authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [], raw_data: rawXml, schema: schema };
    }
  }

  /**
   * Parse Dublin Core formatted records
   * Accepts Node/XPathResult
   */
  private parseDublinCore(
    element: Element,
    recordId: string,
    rawXml: string | undefined,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult
  ): BiblioRecord {
    const record: BiblioRecord = { id: recordId, title: "Untitled", authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [], raw_data: rawXml, schema: 'dublincore' };
    const find = (xpath: string) => this.findElement(element, xpath, nodeConst, xpathResultConst);
    const findAll = (xpath: string) => this.findElements(element, xpath, nodeConst, xpathResultConst);
    const seenNames = new Set<string>();

    // --- REINSTATED parseSourceString helper ---
    const parseSourceString = (source: string): { journal_title?: string; volume?: string; issue?: string; pages?: string; series?: string; } => {
        const result: { journal_title?: string; volume?: string; issue?: string; pages?: string; series?: string; } = {};
        const journalMatch = /([^,]+),\s*(?:Vol(?:ume)?\.?\s*(\d+))?,?\s*(?:No\.?\s*(\d+))?,?\s*(?:pp\.?\s*(\d+(?:-\d+)?))?/.exec(source);
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
    // --- END REINSTATED parseSourceString helper ---


    record.title = find('.//dc:title')?.textContent?.trim() || "Untitled";

    const processName = (name: string | null | undefined, list: string[], roleList?: { name: string; role: string }[], defaultRole?: string) => {
        if (!name) return; name = cleanPersonName(name.trim()); if (!name) return;
        let role = defaultRole || 'author'; let cleanName = name;
        if (/\b(?:ed(?:itor)?|hrsg|hg)\b|\(ed|\(hg/i.test(name)) { role = 'editor'; }
        else if (/\b(?:trans|transl|translator|übersetz|übers)\b|\(trans|\(übers/i.test(name)) { role = 'translator'; }
        cleanName = cleanName.replace(/\s*[([][^)]*(?:ed|hrsg|edit|hg|trans|übersetz)[^)]*[)\]]/g, '').replace(/\s*(?:ed|hrsg|edit|hg|trans|transl|translator|übersetz|übers)\.?\s*$/g, '').trim();
        if (!cleanName || seenNames.has(cleanName)) return;
        seenNames.add(cleanName);
        if (role === 'editor') record.editors.push(cleanName);
        else if (role === 'translator') record.translators.push(cleanName);
        else if (role === 'author') record.authors.push(cleanName);
        else if (roleList) roleList.push({ name: cleanName, role: role });
    };

    findAll('.//dc:creator').forEach(elem => processName(elem.textContent, record.authors));
    findAll('.//dc:contributor').forEach(elem => processName(elem.textContent, record.authors, record.contributors, 'contributor'));

    record.year = find('.//dc:date')?.textContent?.match(/\b(1\d{3}|20\d{2})\b/)?.[1];
    record.publisher_name = find('.//dc:publisher')?.textContent?.trim();
    findAll('.//dc:identifier').forEach(elem => {
        const idText = elem.textContent?.trim().toLowerCase(); if (!idText) return;
        if (idText.includes('isbn')) { record.isbn = idText.match(/(?:isbn[:\s]*)?(\d[\d\-X]+)/)?.[1] || record.isbn; }
        else if (idText.includes('issn')) { record.issn = idText.match(/(?:issn[:\s]*)?(\d{4}-\d{3}[\dX])/)?.[1] || record.issn; }
        else if (idText.includes('doi') || idText.includes('doi.org')) { record.doi = idText.match(/(?:doi[:\s]*)?(?:https?:\/\/doi\.org\/)?(\d+\.\d+\/[^\s]+)/)?.[1] || record.doi; }
        else if (idText.startsWith('http')) { record.urls.push(idText); }
    });
    findAll('.//dc:subject').forEach(elem => { if (elem.textContent?.trim()) record.subjects.push(elem.textContent.trim()); });
    record.abstract = find('.//dc:description')?.textContent?.trim();
    record.language = find('.//dc:language')?.textContent?.trim();
    record.format = find('.//dc:format')?.textContent?.trim();
    const source = find('.//dc:source')?.textContent?.trim();
    if (source) { const parsedSource = parseSourceString(source); Object.assign(record, parsedSource); } // Use the local helper

    // Determine document type logic
    if (record.journal_title && (record.volume || record.issue)) { record.document_type = "Journal Article"; }
    else if (record.series) { record.document_type = "Book Chapter"; }
    else if (record.format?.toLowerCase().includes('book')) { record.document_type = "Book"; }
    else if (record.issn) { record.document_type = "Journal"; }
    else if (record.isbn) { record.document_type = "Book"; }

    return record;
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
    xpathResultConst: typeof XPathResult
  ): BiblioRecord {
    const record: BiblioRecord = { id: recordId, title: "Untitled", authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [], raw_data: rawXml, schema: 'marcxml' };
    // One-pass index of the record's datafields/subfields — avoids re-scanning
    // the whole subtree on each of the ~30 field lookups below.
    const marc = indexMarcRecord(element, nodeConst.ELEMENT_NODE);
    const findData = (tag: string, code: string) => marc.getData(tag, code);
    const findFields = (tag: string, ind1?: string) => marc.getFields(tag, ind1);
    const findSub = (field: Element, code: string) => marc.getSub(field, code);
    const findLead = () => marc.leader;
    const seenNames = new Set<string>();

    let title = findData("245", "a")[0]?.replace(/[/:]$/, '').trim() || "Untitled";
    const subtitle = findData("245", "b")[0]?.trim();
    if (subtitle) title += `: ${subtitle}`; record.title = title;

    const processFieldNames = (fields: Element[], defaultRole: string) => {
        for (const field of fields) {
            const name = findSub(field, "a")?.textContent?.trim(); if (!name) continue;
            const roleText = findSub(field, "e")?.textContent?.trim().toLowerCase();
            let role = defaultRole; let cleanName = name;
            if (roleText) {
                if (/edit|hrsg|hg/.test(roleText)) role = 'editor';
                else if (/transl|übers/.test(roleText)) role = 'translator';
                else role = roleText;
            }
            cleanName = cleanName.replace(/[,.;]$/, '').trim();
            if (!cleanName || seenNames.has(cleanName)) continue; seenNames.add(cleanName);
            if (role === 'editor') record.editors.push(cleanName);
            else if (role === 'translator') record.translators.push(cleanName);
            else if (role === 'author') record.authors.push(cleanName);
            else record.contributors.push({ name: cleanName, role });
        }
    };

    processFieldNames(findFields("100"), 'author');
    processFieldNames(findFields("700"), 'author');

    for (const tag of ["260", "264"]) {
        record.year = record.year || findData(tag, "c")[0]?.match(/\b(1\d{3}|20\d{2})\b/)?.[1];
        record.publisher_name = record.publisher_name || findData(tag, "b")[0]?.replace(/[,:]$/, '').trim();
        record.place_of_publication = record.place_of_publication || findData(tag, "a")[0]?.replace(/:$/, '').trim();
    }
    record.isbn = findData("020", "a")[0]?.match(/(\d[\d\-X]+)/)?.[1] || findData("020", "a")[0];
    record.issn = findData("022", "a")[0];
    findFields("024", "7").forEach(field => { if (findSub(field, "2")?.textContent?.trim().toLowerCase() === "doi") { record.doi = findSub(field, "a")?.textContent?.trim(); } });
    for (const tag of ["650", "651", "653"]) { findData(tag, "a").forEach(s => { if (!record.subjects.includes(s)) record.subjects.push(s); }); }
    // DDC (082) / other classification (084) as subject tags
    findData("082", "a").forEach(c => { const t = `DDC:${c}`; if (!record.subjects.includes(t)) record.subjects.push(t); });
    findData("084", "a").forEach(c => { if (!record.subjects.includes(c)) record.subjects.push(c); });
    // Abstract / summary (520)
    record.abstract = record.abstract || findData("520", "a").join(' ').trim() || undefined;
    // Corporate authors (110 main / 710 added) as single-field names
    findData("110", "a").forEach(n => { const name = n.replace(/[,.;]$/, '').trim(); if (name && !seenNames.has(name)) { seenNames.add(name); record.authors.push(name); } });
    findData("710", "a").forEach(n => { const name = n.replace(/[,.;]$/, '').trim(); if (name && !seenNames.has(name)) { seenNames.add(name); record.contributors.push({ name, role: 'corporate' }); } });
    record.language = findData("041", "a")[0];
    record.series = findData("490", "a")[0] || findData("830", "a")[0];
    record.extent = findData("300", "a")[0];
    if (record.extent) { const pm = record.extent.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:p|pages|S)/i); if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1]; }
    record.edition = findData("250", "a")[0];
    record.urls = findData("856", "u");

    findFields("773").forEach(field => {
        const hostTitle = findSub(field, "t")?.textContent?.trim(); if (!hostTitle) return;
        const volText = findSub(field, "g")?.textContent?.trim() || '';
        const link7 = findSub(field, "7")?.textContent?.trim() || '';
        const hostIssn = findSub(field, "x")?.textContent?.trim(); // 773$x = host ISSN
        // Decide journal-vs-chapter by the host's bibliographic level in 773$7 position 3
        // ('s' = serial -> journal, 'm' = monograph -> chapter). Fall back to sniffing
        // $g for volume/issue markers in BOTH English and German (K10plus uses forms like
        // "78(2024), 3, Seite 205-213" that carry no vol/no keyword at all).
        const hostBibLevel = link7.length >= 4 ? link7[3].toLowerCase() : '';
        let isJournal: boolean;
        if (hostBibLevel === 's') isJournal = true;
        else if (hostBibLevel === 'm') isJournal = false;
        else isJournal = /vol|issue|no\.?|nr\.?|number|band|bd\.?|jg\.?|jahrg|heft|\(\d{4}\)/i.test(volText);

        if (isJournal) {
            // Type is decided authoritatively by the leader below; here we only
            // record the host as the journal and pull volume/issue/pages/ISSN.
            record.journal_title = hostTitle;
            if (hostIssn && !record.issn) record.issn = hostIssn;
            record.volume = volText.match(/(?:vol(?:ume)?|bd\.?|band|jg\.?|jahrg(?:ang)?)\.?\s*(\d+)/i)?.[1]
                || volText.match(/(\d+)\s*\(\d{4}\)/)?.[1]   // "78(2024)"
                || volText.match(/^\s*(\d+)\b/)?.[1]
                || record.volume;
            record.issue = volText.match(/(?:no|nr|issue|num|heft|h)\.?\s*(\d+)/i)?.[1]
                || volText.match(/\)\s*,\s*(\d+)/)?.[1]      // "…(2024), 3,"
                || record.issue;
            const pm = volText.match(/\b(?:seite|pages?|pp?|s)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);
            if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1];
        } else { record.series = hostTitle; }
    });

    // Document type — the leader is authoritative (position 6 = material type,
    // position 7 = bibliographic level). Non-text material wins; otherwise the
    // bibliographic level decides monograph/serial/component.
    const leader = findLead();
    const materialType = leader && leader.length >= 8 ? leader[6] : '';
    const biblioLevel = leader && leader.length >= 8 ? leader[7] : '';
    const NONTEXT: Record<string, string> = {
        c: 'Score', d: 'Score', e: 'Map', f: 'Map', g: 'Video',
        i: 'Audio Recording', j: 'Music', k: 'Image', m: 'Computer File', o: 'Kit', r: 'Object'
    };
    if (NONTEXT[materialType]) { record.document_type = NONTEXT[materialType]; }
    else if (biblioLevel === 'm') { record.document_type = 'Book'; }        // monograph (even in a series)
    else if (biblioLevel === 's') { record.document_type = 'Journal'; }     // the serial itself
    else if (biblioLevel === 'a' || biblioLevel === 'b') {                   // component part
        record.document_type = record.journal_title ? 'Journal Article' : 'Book Chapter';
    }
    else if (biblioLevel === 'c') { record.document_type = 'Book'; }        // collection
    if (!record.document_type) { // Fallback when the leader is missing/uninformative
        if (record.journal_title) { record.document_type = 'Journal Article'; }
        else if (record.isbn) { record.document_type = 'Book'; }
        else if (record.issn) { record.document_type = 'Journal'; }
        else { record.document_type = 'Book'; }
    }
    record.format = record.document_type;
    return record;
  }

  /**
   * Generic record parser
   * Accepts Node/XPathResult
   */
  private parseGeneric(
    element: Element,
    recordId: string,
    rawXml: string | undefined,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult
  ): BiblioRecord {
    const record: BiblioRecord = { id: recordId, title: "Untitled", authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [], raw_data: rawXml, schema: 'generic' };
    const find = (xpath: string) => this.findElement(element, xpath, nodeConst, xpathResultConst);
    const findAll = (xpath: string) => this.findElements(element, xpath, nodeConst, xpathResultConst);

    // Title
    const titlePaths = ['.//dc:title', './/dcterms:title', './/title', './/marc:datafield[@tag="245"]/marc:subfield[@code="a"]', './/mxc:datafield[@tag="245"]/mxc:subfield[@code="a"]'];
    for (const path of titlePaths) { const el = find(path); if (el?.textContent) { record.title = el.textContent.trim(); break; } }
    // Authors/Contributors (basic)
    const creatorPaths = ['.//dc:creator', './/dcterms:creator', './/creator', './/marc:datafield[@tag="100"]/marc:subfield[@code="a"]', './/mxc:datafield[@tag="100"]/mxc:subfield[@code="a"]', './/marc:datafield[@tag="700"]/marc:subfield[@code="a"]', './/mxc:datafield[@tag="700"]/mxc:subfield[@code="a"]'];
    findAll(creatorPaths.join(' | ')).forEach(el => { if (el.textContent?.trim()) record.authors.push(el.textContent.trim()); }); // Simplified: puts all as authors
    // Year
    const yearPaths = ['.//dc:date', './/dcterms:date', './/dcterms:issued', './/date', './/marc:datafield[@tag="260"]/marc:subfield[@code="c"]', './/mxc:datafield[@tag="260"]/mxc:subfield[@code="c"]', './/marc:datafield[@tag="264"]/marc:subfield[@code="c"]', './/mxc:datafield[@tag="264"]/mxc:subfield[@code="c"]'];
    for (const path of yearPaths) { const el = find(path); if (el?.textContent) { const ym = el.textContent.match(/\b(1\d{3}|20\d{2})\b/); if (ym) { record.year = ym[1]; break; } } }
    // Publisher
    const pubPaths = ['.//dc:publisher', './/dcterms:publisher', './/publisher', './/marc:datafield[@tag="260"]/marc:subfield[@code="b"]', './/mxc:datafield[@tag="260"]/mxc:subfield[@code="b"]', './/marc:datafield[@tag="264"]/marc:subfield[@code="b"]', './/mxc:datafield[@tag="264"]/mxc:subfield[@code="b"]'];
    for (const path of pubPaths) { const el = find(path); if (el?.textContent) { record.publisher_name = el.textContent.replace(/[,:]$/, '').trim(); break; } }
    // ISBN
    const isbnPaths = ['.//bibo:isbn13', './/bibo:isbn10', './/bibo:isbn', './/dc:identifier[contains(text(), "ISBN")]', './/marc:datafield[@tag="020"]/marc:subfield[@code="a"]', './/mxc:datafield[@tag="020"]/mxc:subfield[@code="a"]'];
    for (const path of isbnPaths) { const el = find(path); if (el?.textContent) { const im = el.textContent.match(/(?:ISBN[:\s]*)?(\d[\d\-X]+)/); record.isbn = im ? im[1] : el.textContent.trim(); break; } }
    // URLs
    const urlPaths = ['.//foaf:primaryTopic', './/umbel:isLike', './/dc:identifier[contains(text(), "http")]', './/marc:datafield[@tag="856"]/marc:subfield[@code="u"]', './/mxc:datafield[@tag="856"]/mxc:subfield[@code="u"]'];
    findAll(urlPaths.join(' | ')).forEach(el => { const res = this.getResourceAttribute(el); if (res?.startsWith('http') && !record.urls.includes(res)) record.urls.push(res); else if (el.textContent?.trim().startsWith('http') && !record.urls.includes(el.textContent.trim())) record.urls.push(el.textContent.trim()); });

    return record;
  }

  /**
   * Parse RDFxml formatted records
   * Accepts Node/XPathResult
   */
  /**
   * Parse RDFxml formatted records (Revised for DNB structure)
   * Accepts Node/XPathResult
   */
  private parseRdfXml(
    element: Element, // The <recordData> element
    recordId: string,
    rawXml: string | undefined,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult
  ): BiblioRecord {
    const record: BiblioRecord = { id: recordId, title: "Untitled", authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [], raw_data: rawXml, schema: 'RDFxml' };
    const find = (context: Element, xpath: string) => this.findElement(context, xpath, nodeConst, xpathResultConst);
    const findAll = (context: Element, xpath: string) => this.findElements(context, xpath, nodeConst, xpathResultConst);
    const seenNames = new Set<string>(); // Keep track of names added

    // Helper to process names and roles (can be simplified if roles aren't complex in DNB data)
    const processNameWithRole = (name: string | null | undefined): { cleanName: string | null; role: string; isDuplicate: boolean; } => {
        if (!name) return { cleanName: null, role: 'author', isDuplicate: true };
        name = cleanPersonName(name.trim()); if (!name) return { cleanName: null, role: 'author', isDuplicate: true };
        let role = 'author'; // Default role
        let cleanName = name;
        // Basic role detection (can be expanded if needed)
        if (/\([Hh]g\.?\)|\([Hh]rsg\.?\)|\([Ee]d\.?\)/i.test(name)) { role = 'editor'; }
        else if (/\([Üü]bers\.?\)|\([Tt]rans\.?\)/i.test(name)) { role = 'translator'; }
        // Remove potential role indicators in parentheses and trailing punctuation
        cleanName = cleanName.replace(/\s*\(.*?\)\s*$/,'').replace(/[,.;]$/, '').trim();
        if (!cleanName) return { cleanName: null, role, isDuplicate: true };
        const isDuplicate = seenNames.has(cleanName); if (!isDuplicate) seenNames.add(cleanName);
        return { cleanName, role, isDuplicate };
    };

    // Find the main <rdf:Description> for the item
    const desc = find(element, './/rdf:Description[not(@rdf:nodeID)]'); // Find the main description, not blank nodes
    if (!desc) {
        ztoolkit.log(`No main RDF:Description found in record ${recordId}`, 'warn');
        return record; // Return minimal record if structure is unexpected
    }

    // --- Title and Subtitle ---
    record.title = find(desc, './dc:title')?.textContent?.trim() || "Untitled";
    const subtitle = find(desc, './rdau:P60493')?.textContent?.trim();
    // Append subtitle only if it exists and isn't already obviously part of the title
    if (subtitle && record.title !== "Untitled" && !record.title.includes(subtitle) && !record.title.endsWith(':')) {
        record.title += `: ${subtitle}`;
    } else if (subtitle && record.title === "Untitled") {
        record.title = subtitle; // Use subtitle as title if main title is missing
    }

    // --- Author ---
    // Priority 1: Parse the Statement of Responsibility literal
    const statementOfResponsibility = find(desc, './rdau:P60327')?.textContent?.trim();
    if (statementOfResponsibility) {
        // Basic split, assumes single author here based on example
        const potentialAuthors = statementOfResponsibility.split(';')[0].split(',').map(s => s.trim()).filter(Boolean);
        potentialAuthors.forEach(name => {
            const { cleanName, role, isDuplicate } = processNameWithRole(name);
            // Add only if it seems like an author and not already found
            if (cleanName && !isDuplicate && role === 'author') {
                ztoolkit.log(`Record ${recordId}: Adding author from P60327: ${cleanName}`);
                record.authors.push(cleanName);
            } else if (cleanName && !isDuplicate && role === 'editor') {
                 ztoolkit.log(`Record ${recordId}: Adding editor from P60327: ${cleanName}`);
                 record.editors.push(cleanName);
            } // Add other roles if needed
        });
    }

    // Priority 2: If no author found yet, check dcterms:creator (less reliable for name here)
    // This logic is less useful now as the linked description isn't included.
    // We keep the GND ID extraction for potential future use or debugging.
    if (record.authors.length === 0) {
        findAll(desc, './dcterms:creator').forEach(creator => {
            const resource = this.getResourceAttribute(creator);
            if (resource) {
                ztoolkit.log(`Record ${recordId}: Found dcterms:creator link: ${resource}. Name not directly available in record.`, 'warn');
                // Could store the GND ID if needed: record.gndId = resource.split('/').pop();
            } else if (creator.textContent) {
                 // Fallback if dcterms:creator has a literal name (unlikely in DNB RDF)
                 const { cleanName, role, isDuplicate } = processNameWithRole(creator.textContent);
                 if (cleanName && !isDuplicate && role === 'author') {
                     ztoolkit.log(`Record ${recordId}: Adding author from literal dcterms:creator: ${cleanName}`);
                     record.authors.push(cleanName);
                 }
            }
        });
    }

    // --- Other Fields (mostly unchanged, verified against XML) ---
    record.year = find(desc, './dcterms:issued')?.textContent?.match(/\b(1\d{3}|20\d{2})\b/)?.[1];
    record.publisher_name = find(desc, './dc:publisher')?.textContent?.trim();
    record.place_of_publication = find(desc, './rdau:P60163')?.textContent?.trim(); // Use P60163 for place
    record.edition = find(desc, './bibo:edition')?.textContent?.trim();

    // Extent / Pages
    record.extent = find(desc, './isbd:P1053')?.textContent?.trim() || find(desc, './dcterms:extent')?.textContent?.trim();
    if (record.extent) {
        // Match digits possibly followed by " S." or " Seiten" etc.
        const pm = record.extent.match(/(\d+)\s*(?:S\.|Seiten)?/i);
        if (pm) record.pages = pm[1]; // Extract just the number
    }

    // Document Type (Infer from ISBN if generic)
    const typeElement = find(desc, './dcterms:type') || find(desc, './dc:type') || find(desc, './rdf:type');
    if (typeElement) {
        const res = this.getResourceAttribute(typeElement);
        const typeUri = res || typeElement.textContent?.trim();
        // Extract meaningful part or use text content
        record.document_type = typeUri?.includes('/') ? typeUri.split('/').pop() : typeUri;
        // If type is too generic (like 'Document'), try to infer
        if (record.document_type === 'Document' || !record.document_type) {
            for (const isbnField of ['isbn13', 'isbn10', 'isbn', 'gtin14']) {
                const el = find(desc, `./bibo:${isbnField}`);
                if (el?.textContent) {
                    record.document_type = "Book"; // Infer Book if ISBN exists
                    break;
                }
            }
        }
    } else { // Fallback if no type element found at all
        for (const isbnField of ['isbn13', 'isbn10', 'isbn', 'gtin14']) {
             const el = find(desc, `./bibo:${isbnField}`);
             if (el?.textContent) { record.document_type = "Book"; break; }
        }
    }
    record.format = record.document_type; // Use document_type as format

    // ISBN (find first available)
    for (const isbnField of ['isbn13', 'isbn10', 'isbn', 'gtin14']) {
        const el = find(desc, `./bibo:${isbnField}`);
        if (el?.textContent) {
            record.isbn = el.textContent.trim().replace(/-/g, ''); // Clean ISBN
            break;
        }
    }
    record.issn = find(desc, './bibo:issn')?.textContent?.trim();
    record.doi = find(desc, './bibo:doi')?.textContent?.trim();

    // Subjects (Combine GND links and DDC codes)
    const seenSubjects = new Set<string>();
    // GND Subject Links
    findAll(desc, './dcterms:subject').forEach(subj => {
        const res = this.getResourceAttribute(subj);
        if (res && res.includes('d-nb.info/gnd/')) {
            const gndId = res.split('/').pop(); // Get GND ID
            if (gndId && !seenSubjects.has(gndId)) {
                record.subjects.push(gndId); // Add GND ID as subject tag
                seenSubjects.add(gndId);
            }
        } else if (subj.textContent?.trim() && !seenSubjects.has(subj.textContent.trim())) {
             // Fallback for literal subjects if any
             record.subjects.push(subj.textContent.trim());
             seenSubjects.add(subj.textContent.trim());
        }
    });
    // DDC Subject Codes
    findAll(desc, './dc:subject[@rdf:datatype="https://d-nb.info/standards/elementset/dnb#ddc-subject-category"]').forEach(subj => {
         const ddcCode = subj.textContent?.trim();
         if (ddcCode && !seenSubjects.has(`DDC:${ddcCode}`)) { // Prefix DDC codes
             record.subjects.push(`DDC:${ddcCode}`);
             seenSubjects.add(`DDC:${ddcCode}`);
         }
    });

    // Language
    const langEl = find(desc, './dcterms:language');
    if (langEl) {
        const res = this.getResourceAttribute(langEl);
        // Extract code like 'ger' from 'http://id.loc.gov/vocabulary/iso639-2/ger'
        record.language = res ? res.split('/').pop() : langEl.textContent?.trim();
    }

    // Abstract
    for (const path of ['./dc:description', './dcterms:abstract']) {
        const el = find(desc, path);
        if (el?.textContent) {
            record.abstract = el.textContent.trim();
            break;
        }
    }

    // URLs (Example uses foaf:primaryTopic, umbel:isLike, also check rdau:P60372 for ToC)
    findAll(desc, './foaf:primaryTopic | ./umbel:isLike | ./rdau:P60372').forEach(el => {
        const res = this.getResourceAttribute(el);
        if (res?.startsWith('http') && !record.urls.includes(res)) {
            record.urls.push(res);
        } else if (el.textContent?.trim().startsWith('http') && !record.urls.includes(el.textContent.trim())) {
             record.urls.push(el.textContent.trim());
        }
    });

    // Cleanup empty arrays
    
    record.authors = record.authors || [];
    record.editors = record.editors || [];
    record.translators = record.translators || [];
    record.contributors = record.contributors || [];
    record.urls = record.urls || [];
    record.subjects = record.subjects || [];

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
      xpathResultConst: typeof XPathResult
  ): Element | null {
      try {
          const doc = contextNode.ownerDocument || (contextNode as Document);
          if (!doc.evaluate) { ztoolkit.log("doc.evaluate not found.", 'error'); return null; }
          const nsResolver = this.createNsResolver(doc);
          const result = doc.evaluate(xpath, contextNode, nsResolver, xpathResultConst.FIRST_ORDERED_NODE_TYPE, null);
          if (result.singleNodeValue && result.singleNodeValue.nodeType === nodeConst.ELEMENT_NODE) {
               return result.singleNodeValue as Element;
          }
          return null;
      } catch (e: any) { ztoolkit.log(`Error evaluating XPath "${xpath}": ${e.message}`, 'error'); return null; }
  }

  /**
   * Helper method to find multiple XML elements using XPath.
   * Accepts Node/XPathResult
   */
  private findElements(
      contextNode: Document | Element,
      xpath: string,
      nodeConst: typeof Node,
      xpathResultConst: typeof XPathResult
  ): Element[] {
      const elements: Element[] = [];
      try {
          const doc = contextNode.ownerDocument || (contextNode as Document);
          if (!doc.evaluate) { ztoolkit.log("doc.evaluate not found.", 'error'); return []; }
          const nsResolver = this.createNsResolver(doc);
          const iterator = doc.evaluate(xpath, contextNode, nsResolver, xpathResultConst.ORDERED_NODE_ITERATOR_TYPE, null);
          let node = iterator.iterateNext();
          while (node) {
              if (node.nodeType === nodeConst.ELEMENT_NODE) {
                  elements.push(node as Element);
              }
              node = iterator.iterateNext();
          }
      } catch (e: any) { ztoolkit.log(`Error evaluating XPath iterator "${xpath}": ${e.message}`, 'error'); }
      return elements;
  }

  /** Helper to get RDF resource attribute */
  private getResourceAttribute(element: Element): string | null {
    for (const prefix of ['rdf', '']) {
      const attr = element.getAttribute(`${prefix}:resource`) || element.getAttribute('resource');
      if (attr) return attr;
    }
    if (element.localName === 'Description' && element.namespaceURI === NAMESPACES.rdf) {
        const aboutAttr = element.getAttribute('rdf:about') || element.getAttribute('about');
        if (aboutAttr) return aboutAttr;
    }
    return null;
  }

} // End SRUClient