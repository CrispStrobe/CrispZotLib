// src/modules/librarySearch/sruClient.ts - SRU protocol client implementation

import { BiblioRecord } from './models';
import { NAMESPACES } from './endpoints';

// Helper function to escape special characters in a query string
export function escapeQueryString(query: string): string {
  return encodeURIComponent(query)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+');
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

      const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/xml' } });
      if (!response.ok) throw new Error(`SRU request failed: ${response.status} ${response.statusText}`);

      const xmlText = await response.text();
      const parser = new domParserConst(); // Use passed DOMParser
      const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

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
          let recordId = recordIdElement?.textContent || positionElement?.textContent || `record-${records.length + 1}`;

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
        if (!name) return; name = name.trim(); if (!name) return;
        let role = defaultRole || 'author'; let cleanName = name;
        if (/\b(?:ed(?:itor)?|hrsg|hg)\b|\(ed|\(hg/i.test(name)) { role = 'editor'; }
        else if (/\b(?:trans|transl|translator|übersetz|übers)\b|\(trans|\(übers/i.test(name)) { role = 'translator'; }
        cleanName = cleanName.replace(/\s*[\(\[][^)]*(?:ed|hrsg|edit|hg|trans|übersetz)[^)]*[\)\]]/g, '').replace(/\s*(?:ed|hrsg|edit|hg|trans|transl|translator|übersetz|übers)\.?\s*$/g, '').trim();
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
    const findData = (tag: string, code: string) => this.findDatafields(element, tag, code, nodeConst, xpathResultConst);
    const findFields = (tag: string, ind1?: string) => this.findDatafieldElements(element, tag, ind1, nodeConst, xpathResultConst);
    const findSub = (field: Element, code: string) => this.findSubfield(field, code, nodeConst, xpathResultConst);
    const findLead = () => this.findLeader(element, nodeConst, xpathResultConst);
    const seenNames = new Set<string>();

    let title = findData("245", "a")[0]?.replace(/[\/:]$/, '').trim() || "Untitled";
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
    record.language = findData("041", "a")[0];
    record.series = findData("490", "a")[0] || findData("830", "a")[0];
    record.extent = findData("300", "a")[0];
    if (record.extent) { const pm = record.extent.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:p|pages|S)/i); if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1]; }
    record.edition = findData("250", "a")[0];
    record.urls = findData("856", "u");

    findFields("773").forEach(field => {
        const hostTitle = findSub(field, "t")?.textContent?.trim(); if (!hostTitle) return;
        const volText = findSub(field, "g")?.textContent?.trim();
        if (volText && /vol|issue|number|no\.|band/i.test(volText)) {
            record.journal_title = hostTitle; record.document_type = 'Journal Article';
            record.volume = volText.match(/vol(?:ume)?\.?\s*(\d+)/i)?.[1] || record.volume;
            record.issue = volText.match(/(?:no|issue|num)\.?\s*(\d+)/i)?.[1] || record.issue;
            const pm = volText.match(/p(?:age)?s?\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/i); if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1];
        } else { record.series = hostTitle; if (!record.document_type) record.document_type = 'Book Chapter'; }
    });

    const leader = findLead();
    if (!record.document_type && leader && leader.length >= 8) {
        const materialType = leader[6]; const biblioLevel = leader[7];
        if (materialType === 'a' && biblioLevel === 's') { record.document_type = 'Journal'; }
        else if (materialType === 'a' && biblioLevel === 'm') { record.document_type = 'Book'; }
        else if (materialType === 'a' && biblioLevel === 'a') { record.document_type = 'Journal Article'; }
        else if (materialType === 'a' && biblioLevel === 'c') { record.document_type = 'Book Chapter'; }
        else if (materialType === 'e') { record.document_type = 'Map'; }
        else if (materialType === 'g') { record.document_type = 'Video'; }
        else if (materialType === 'j') { record.document_type = 'Music'; }
        else if (materialType === 'k') { record.document_type = 'Image'; }
        else if (materialType === 'm') { record.document_type = 'Computer File'; }
    }
    if (!record.document_type) { // Fallback type detection
        if (record.journal_title) { record.document_type = 'Journal Article'; }
        else if (record.issn) { record.document_type = 'Journal'; }
        else if (record.isbn) { record.document_type = 'Book'; }
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
  private parseRdfXml(
    element: Element,
    recordId: string,
    rawXml: string | undefined,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult
  ): BiblioRecord {
    const record: BiblioRecord = { id: recordId, title: "Untitled", authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [], raw_data: rawXml, schema: 'RDFxml' };
    const find = (context: Element, xpath: string) => this.findElement(context, xpath, nodeConst, xpathResultConst);
    const findAll = (context: Element, xpath: string) => this.findElements(context, xpath, nodeConst, xpathResultConst);
    const seenNames = new Set<string>();

    const processNameWithRole = (name: string | null | undefined): { cleanName: string | null; role: string; isDuplicate: boolean; } => {
        if (!name) return { cleanName: null, role: 'author', isDuplicate: true };
        name = name.trim(); if (!name) return { cleanName: null, role: 'author', isDuplicate: true };
        let role = 'author'; let cleanName = name;
        if (/\([Hh]g\.?\)|\([Hh]rsg\.?\)|\([Ee]d\.?\)|\b[Hh]g\.|\b[Hh]rsg\.|\b[Ee]d\./i.test(name)) { role = 'editor'; }
        else if (/\([Üü]bers\.?\)|\([Tt]rans\.?\)|\b[Üü]bers\.|\b[Tt]rans\./i.test(name)) { role = 'translator'; }
        cleanName = cleanName.replace(/\s*\(.*?\)\s*$/,'').replace(/[,.;]$/, '').trim(); // Basic cleaning
        if (!cleanName) return { cleanName: null, role, isDuplicate: true };
        const isDuplicate = seenNames.has(cleanName); if (!isDuplicate) seenNames.add(cleanName);
        return { cleanName, role, isDuplicate };
    };

    const desc = find(element, './/rdf:Description'); if (!desc) { ztoolkit.log(`No RDF:Description found in record ${recordId}`, 'warn'); return record; }
    record.title = find(desc, './dc:title')?.textContent?.trim() || "Untitled";
    const subtitle = find(desc, './rdau:P60493')?.textContent?.trim(); if (subtitle && !record.title.includes(':')) record.title += `: ${subtitle}`;

    const contributorStatement = find(desc, './rdau:P60327')?.textContent?.trim();
    if (contributorStatement) { /* ... parse contributor statement ... */ } // Simplified

    for (const creatorPath of ['./dcterms:creator', './dc:creator']) {
        findAll(desc, creatorPath).forEach(creator => {
            const resource = this.getResourceAttribute(creator);
            let nameText: string | null | undefined = null;
            if (resource) {
                const creatorDesc = find(element, `.//rdf:Description[@rdf:about="${resource}"]`);
                nameText = find(creatorDesc || desc, './gndo:preferredName')?.textContent; // Use desc as fallback context
            } else { nameText = creator.textContent; }
            const { cleanName, role, isDuplicate } = processNameWithRole(nameText);
            if (cleanName && !isDuplicate) {
                if (role === 'editor') record.editors.push(cleanName);
                else if (role === 'translator') record.translators.push(cleanName);
                else record.authors.push(cleanName);
            }
        });
    }
    record.year = find(desc, './dcterms:issued')?.textContent?.match(/\b(1\d{3}|20\d{2})\b/)?.[1];
    record.publisher_name = find(desc, './dc:publisher')?.textContent?.trim();
    record.place_of_publication = findAll(desc, './rdau:P60163').map(el => el.textContent?.trim()).filter(Boolean).join(", ");
    record.edition = find(desc, './bibo:edition')?.textContent?.trim();
    record.extent = find(desc, './isbd:P1053')?.textContent?.trim() || find(desc, './dcterms:extent')?.textContent?.trim();
    if (record.extent) { const pm = record.extent.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:p|pages|S)/i); if (pm) record.pages = pm[2] ? `${pm[1]}-${pm[2]}` : pm[1]; }
    const typeElement = find(desc, './dcterms:type') || find(desc, './dc:type'); if (typeElement) { const res = this.getResourceAttribute(typeElement); record.document_type = res ? res.split('/').pop() : typeElement.textContent?.trim(); }
    for (const isbnField of ['isbn13', 'isbn10', 'isbn', 'gtin14']) { const el = find(desc, `./bibo:${isbnField}`); if (el?.textContent) { record.isbn = el.textContent.trim(); break; } }
    record.issn = find(desc, './bibo:issn')?.textContent?.trim();
    record.doi = find(desc, './bibo:doi')?.textContent?.trim();
    const seenSubjects = new Set<string>(); findAll(desc, './dcterms:subject | ./dc:subject').forEach(subj => { const res = this.getResourceAttribute(subj); const val = res ? res.split('/').pop() : subj.textContent?.trim(); if (val && !seenSubjects.has(val)) { record.subjects.push(val); seenSubjects.add(val); } });
    const langEl = find(desc, './dcterms:language'); if (langEl) { const res = this.getResourceAttribute(langEl); record.language = res ? res.split('/').pop() : langEl.textContent?.trim(); }
    for (const path of ['./dc:description', './dcterms:abstract']) { const el = find(desc, path); if (el?.textContent) { record.abstract = el.textContent.trim(); break; } }
    findAll(desc, './foaf:primaryTopic | ./umbel:isLike').forEach(el => { const res = this.getResourceAttribute(el); if (res?.startsWith('http') && !record.urls.includes(res)) record.urls.push(res); });
    const citation = find(desc, './dcterms:bibliographicCitation')?.textContent?.trim(); if (citation && (!record.volume || !record.issue || !record.pages)) { /* ... extract vol/issue/pages ... */ }
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

  /** Helper for finding MARC datafields - MODIFIED */
  private findDatafields(
      element: Element, tag: string, code: string,
      nodeConst: typeof Node, xpathResultConst: typeof XPathResult
  ): string[] {
      const results: string[] = [];
      const processFields = (xpathPrefix: string) => {
          // Use localName() check for namespace-agnostic matching if needed, or stick to prefixes
          const fields = this.findElements(element, `.//*[local-name()='datafield' and @tag='${tag}']`, nodeConst, xpathResultConst); // Namespace-agnostic example
          // const fields = this.findElements(element, `${xpathPrefix}:datafield[@tag="${tag}"]`, nodeConst, xpathResultConst); // Prefix-based
          for (const field of fields) {
              const subfields = this.findElements(field, `.//*[local-name()='subfield' and @code='${code}']`, nodeConst, xpathResultConst); // Namespace-agnostic example
              // const subfields = this.findElements(field, `${xpathPrefix}:subfield[@code="${code}"]`, nodeConst, xpathResultConst); // Prefix-based
              subfields.forEach(sf => { if (sf.textContent) results.push(sf.textContent.trim()); });
          }
      };
      // Call processFields for relevant prefixes or use namespace-agnostic approach
      processFields(''); // Try namespace-agnostic first
      // processFields('.//marc'); processFields('.//mxc'); // Or try specific prefixes
      return results;
  }

  /** Helper for finding MARC datafield elements - MODIFIED */
  private findDatafieldElements(
      element: Element, tag: string, ind1: string | undefined,
      nodeConst: typeof Node, xpathResultConst: typeof XPathResult
  ): Element[] {
      let results: Element[] = [];
      const processFields = (xpathPrefix: string) => {
          let selector = `${xpathPrefix}:datafield[@tag="${tag}"]`;
          if (ind1) selector += `[@ind1="${ind1}"]`;
          // Use namespace-agnostic matching if needed
          let nsAgnosticSelector = `.//*[local-name()='datafield' and @tag='${tag}']`;
          if (ind1) nsAgnosticSelector += `[@ind1='${ind1}']`;
          // results = results.concat(this.findElements(element, selector, nodeConst, xpathResultConst)); // Prefix-based
          results = results.concat(this.findElements(element, nsAgnosticSelector, nodeConst, xpathResultConst)); // Namespace-agnostic
      };
      // Call processFields for relevant prefixes or use namespace-agnostic approach
      processFields(''); // Try namespace-agnostic first
      // processFields('.//marc'); processFields('.//mxc'); // Or try specific prefixes
      return results;
  }

  /** Helper for finding a subfield in a MARC datafield - MODIFIED */
  private findSubfield(
      datafield: Element, code: string,
      nodeConst: typeof Node, xpathResultConst: typeof XPathResult
  ): Element | null {
      // Use namespace-agnostic matching
      return this.findElement(datafield, `.//*[local-name()='subfield' and @code='${code}']`, nodeConst, xpathResultConst);
      // Or prefix-based:
      // return this.findElement(datafield, `.//marc:subfield[@code="${code}"]`, nodeConst, xpathResultConst) ||
      //        this.findElement(datafield, `.//mxc:subfield[@code="${code}"]`, nodeConst, xpathResultConst) ||
      //        this.findElement(datafield, `subfield[@code="${code}"]`, nodeConst, xpathResultConst);
  }

   /** Helper for finding MARC leader element - MODIFIED */
  private findLeader(
      element: Element,
      nodeConst: typeof Node, xpathResultConst: typeof XPathResult
  ): string | null {
      // Use namespace-agnostic matching
      const leader = this.findElement(element, `.//*[local-name()='leader']`, nodeConst, xpathResultConst);
      // Or prefix-based:
      // const leader = this.findElement(element, './/marc:leader', nodeConst, xpathResultConst) ||
      //                this.findElement(element, './/mxc:leader', nodeConst, xpathResultConst) ||
      //                this.findElement(element, 'leader', nodeConst, xpathResultConst);
      return leader?.textContent || null;
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