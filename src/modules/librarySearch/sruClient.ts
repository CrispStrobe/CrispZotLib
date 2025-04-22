// sruClient.ts - SRU protocol client implementation

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
  private parser: DOMParser;

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
      this.parser = new DOMParser();
      this.namespaces = { ...NAMESPACES, ...(_namespaces || {}) };
      this.queryParams = _queryParams || {};
      this.version = _version;
      this.timeout = _timeout;
      this.defaultSchema = _defaultSchema;
      this.queryParams = _queryParams || {};
    }
  /*
    constructor(
    private _baseUrl: string, 
    defaultSchema?: string, 
    version: string = "1.1",
    timeout: number = 30000,
    namespaces?: Record<string, string>,
    queryParams?: Record<string, string>
  ) {
    // this._baseUrl = baseUrl;
    this.defaultSchema = defaultSchema;
    this.version = version;
    this.timeout = timeout;
    this.namespaces = { ...NAMESPACES, ...(namespaces || {}) };
    this.queryParams = queryParams || {};
    this.parser = new DOMParser();
  }
  */

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
    
    // Base parameters
    const params: Record<string, string> = {
      'version': this.version,
      'operation': 'searchRetrieve',
      'query': query,
      'maximumRecords': maxRecords.toString(),
      'startRecord': startRecord.toString()
    };
    
    // Add schema if specified
    if (actualSchema) {
      params['recordSchema'] = actualSchema;
    }
    
    // Add additional query parameters
    Object.assign(params, this.queryParams);
    
    // Construct URL
    const paramString = Object.entries(params)
      .map(([key, value]) => `${key}=${escapeQueryString(value)}`)
      .join('&');
    
    if (this.baseUrl.includes('?')) {
      return `${this.baseUrl}&${paramString}`;
    } else {
      return `${this.baseUrl}?${paramString}`;
    }
  }

  /**
     * Creates a namespace resolver function for document.evaluate.
     * Safely handles potentially null documentElement.
     */
  private createNsResolver(doc: Document): XPathNSResolver {
    const nsMap = this.namespaces; // Use the namespaces defined in the constructor

    // Safely access namespaceURI using optional chaining (?.)
    // and provide null as a fallback using nullish coalescing (??)
    // if documentElement is null or namespaceURI is null/undefined.
    const defaultNS = doc.documentElement?.namespaceURI ?? null;

    return {
        lookupNamespaceURI: function(prefix: string | null): string | null {
            // Handle the default namespace if prefix is null or empty
            if (!prefix) {
                // Return the defaultNS we safely retrieved (which could be null)
                return defaultNS;
            }
            // Look up the specific prefix in our map
            return nsMap[prefix] || null; // Return from map or null if not found
        }
    };
  }

  /**
   * Execute an SRU search query and return parsed BiblioRecord objects
   */
  async search(
    query: string,
    schema?: string,
    maxRecords: number = 10,
    startRecord: number = 1
  ): Promise<[number, BiblioRecord[]]> {
    try {
      // Build URL and execute query
      const url = this.buildQueryUrl(query, schema, maxRecords, startRecord);
      console.log(`Executing SRU query: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        }
      });
      
      if (!response.ok) {
        throw new Error(`SRU request failed: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for diagnostics/errors
      const diagnostics = this.checkForDiagnostics(xmlDoc);
      if (diagnostics.length > 0) {
        console.warn("SRU diagnostics found:", diagnostics);
        
        // For BNF, retry with different schema if marcxchange was rejected
        if (this.baseUrl.includes('catalogue.bnf.fr') && 
            schema === 'marcxchange' && 
            diagnostics.some(d => d.includes('schema'))) {
          console.log("Retrying BNF query with dublincore schema");
          return this.search(query, 'dublincore', maxRecords, startRecord);
        }
      }
      
      // Get number of records
      const numberOfRecordsElement = this.findElement(xmlDoc, './/srw:numberOfRecords');
      const totalRecords = numberOfRecordsElement ? 
        parseInt(numberOfRecordsElement.textContent || '0', 10) : 0;
      
      console.log(`Found ${totalRecords} total records`);
      
      if (totalRecords === 0) {
        return [0, []];
      }
      
      // Extract records
      const records: BiblioRecord[] = [];
      const recordElements = this.findElements(xmlDoc, './/srw:record');
      
      for (const recordElement of recordElements) {
        try {
          // Get record schema
          const schemaElement = this.findElement(recordElement, './/srw:recordSchema');
          const recordSchema = schemaElement?.textContent?.trim() || schema || this.defaultSchema;
          
          // Get record data
          const recordDataElement = this.findElement(recordElement, './/srw:recordData');
          if (!recordDataElement) continue;
          
          // Get record identifier
          const recordIdElement = this.findElement(recordElement, './/srw:recordIdentifier');
          const positionElement = this.findElement(recordElement, './/srw:recordPosition');
          
          let recordId = recordIdElement?.textContent || 
                         positionElement?.textContent || 
                         `record-${records.length + 1}`;
          
          // Create a serializer to get the XML string
          const serializer = new XMLSerializer();
          const rawXml = serializer.serializeToString(recordDataElement);
          
          // Parse the record based on its schema
          const record = this.parseRecord(recordDataElement, recordId, recordSchema, rawXml);
          if (record) {
            records.push(record);
          }
        } catch (e) {
          console.error('Error parsing record:', e);
        }
      }
      
      return [totalRecords, records];
    } catch (e) {
      console.error('SRU search error:', e);
      return [0, []];
    }
  }

  /**
   * Check for diagnostic messages in the SRU response
   */
  private checkForDiagnostics(xmlDoc: Document): string[] {
    const diagnosticMessages: string[] = [];
    
    // BNF-specific diagnostics
    const bnfDiagnostics = this.findElements(xmlDoc, './/sd:diagnostic');
    for (const diag of bnfDiagnostics) {
      const messageElem = this.findElement(diag, './sd:message');
      const detailsElem = this.findElement(diag, './sd:details');
      
      if (messageElem?.textContent) {
        diagnosticMessages.push(messageElem.textContent);
      }
      
      if (detailsElem?.textContent) {
        diagnosticMessages.push(detailsElem.textContent);
      }
    }
    
    // Standard SRU diagnostics
    const sruDiagnostics = this.findElements(xmlDoc, './/srw:diagnostics/sd:diagnostic');
    for (const diag of sruDiagnostics) {
      const messageElem = this.findElement(diag, './sd:message');
      const detailsElem = this.findElement(diag, './sd:details');
      
      if (messageElem?.textContent) {
        diagnosticMessages.push(messageElem.textContent);
      }
      
      if (detailsElem?.textContent) {
        diagnosticMessages.push(detailsElem.textContent);
      }
    }
    
    return diagnosticMessages;
  }

  /**
   * Parse a record based on its schema
   */
  private parseRecord(
    recordDataElement: Element, 
    recordId: string, 
    schema?: string,
    rawXml?: string
  ): BiblioRecord | null {
    try {
      // Choose parser based on schema
      switch(schema) {
        case 'dublincore':
        case 'dc':
        case 'info:srw/schema/1/dc-v1.1':
          return this.parseDublinCore(recordDataElement, recordId, rawXml);
        
        case 'marcxml':
        case 'MARC21-xml':
        case 'info:srw/schema/1/marcxml-v1.1':
          return this.parseMarcXml(recordDataElement, recordId, rawXml);
        
        case 'RDFxml':
          return this.parseRdfXml(recordDataElement, recordId, rawXml);
        
        default:
          // Generic parsing as fallback
          return this.parseGeneric(recordDataElement, recordId, rawXml);
      }
    } catch (e) {
      console.error(`Error parsing record ${recordId}:`, e);
      
      // Return minimal record on error
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
        schema: schema
      };
    }
  }

  /**
   * Parse Dublin Core formatted records
   */
  private parseDublinCore(
    element: Element, 
    recordId: string,
    rawXml?: string
  ): BiblioRecord {
    // Initialize record with default values
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
      schema: 'dublincore'
    };
    
    // Get title
    const titleElement = this.findElement(element, './/dc:title');
    if (titleElement?.textContent) {
      record.title = titleElement.textContent.trim();
    }
    
    // Process creators (authors, editors, translators)
    const seenNames = new Set<string>();
    
    // Process creators
    const creatorElements = this.findElements(element, './/dc:creator');
    for (const elem of creatorElements) {
      if (!elem.textContent) continue;
      
      const name = elem.textContent.trim();
      if (!name) continue;
      
      // Check if it's an editor
      if (/\b(?:ed(?:itor)?|hrsg|hg)\b/i.test(name) || 
          /\(ed/i.test(name) || 
          /\(hg/i.test(name) || 
          /\(hg\.\)/i.test(name)) {
          
        // Clean editor name
        let cleanName = name.replace(/\s*[\(\[][^)]*(?:ed|hrsg|edit|hg)[^)]*[\)\]]/g, '')
                          .replace(/\s*(?:ed|hrsg|edit|hg)\.?(?:\s+|$)/g, '')
                          .trim();
        
        if (cleanName && !seenNames.has(cleanName)) {
          record.editors.push(cleanName);
          seenNames.add(cleanName);
        }
        continue;
      }
      
      // Check if it's a translator
      if (/\b(?:trans|transl|translator|übersetz|übers)\b/i.test(name)) {
        // Clean translator name
        let cleanName = name.replace(/\s*[\(\[][^)]*(?:trans|übersetz)[^)]*[\)\]]/g, '')
                          .replace(/\s*(?:trans|transl|translator|übersetz|übers)\.?(?:\s+|$)/g, '')
                          .trim();
        
        if (cleanName && !seenNames.has(cleanName)) {
          record.translators.push(cleanName);
          seenNames.add(cleanName);
        }
        continue;
      }
      
      // Regular author
      if (!seenNames.has(name)) {
        record.authors.push(name);
        seenNames.add(name);
      }
    }
    
    // Process contributors
    const contributorElements = this.findElements(element, './/dc:contributor');
    for (const elem of contributorElements) {
      if (!elem.textContent) continue;
      
      const name = elem.textContent.trim();
      if (!name) continue;
      
      // Check if it's an editor
      if (/\b(?:ed(?:itor)?|hrsg|hg)\b/i.test(name) || 
          /\(ed/i.test(name) || 
          /\(hg/i.test(name)) {
          
        // Clean editor name
        let cleanName = name.replace(/\s*[\(\[][^)]*(?:ed|hrsg|edit|hg)[^)]*[\)\]]/g, '')
                          .replace(/\s*(?:ed|hrsg|edit|hg)\.?(?:\s+|$)/g, '')
                          .trim();
        
        if (cleanName && !seenNames.has(cleanName)) {
          record.editors.push(cleanName);
          seenNames.add(cleanName);
        }
        continue;
      }
      
      // Check if it's a translator
      if (/\b(?:trans|transl|translator|übersetz|übers)\b/i.test(name)) {
        // Clean translator name
        let cleanName = name.replace(/\s*[\(\[][^)]*(?:trans|übersetz)[^)]*[\)\]]/g, '')
                          .replace(/\s*(?:trans|transl|translator|übersetz|übers)\.?(?:\s+|$)/g, '')
                          .trim();
        
        if (cleanName && !seenNames.has(cleanName)) {
          record.translators.push(cleanName);
          seenNames.add(cleanName);
        }
        continue;
      }
      
      // Regular contributor
      if (!seenNames.has(name)) {
        record.contributors.push({ name, role: 'contributor' });
        seenNames.add(name);
      }
    }
    
    // Find date/year
    const dateElement = this.findElement(element, './/dc:date');
    if (dateElement?.textContent) {
      const dateText = dateElement.textContent.trim();
      // Extract year using regex
      const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
      if (yearMatch) {
        record.year = yearMatch[1];
      }
    }
    
    // Find publisher
    const publisherElement = this.findElement(element, './/dc:publisher');
    if (publisherElement?.textContent) {
      record.publisher_name = publisherElement.textContent.trim();
    }
    
    // Find identifiers (ISBN, ISSN, DOI)
    const identifierElements = this.findElements(element, './/dc:identifier');
    for (const elem of identifierElements) {
      if (!elem.textContent) continue;
      
      const idText = elem.textContent.trim().toLowerCase();
      
      // Extract ISBN
      if (idText.includes('isbn')) {
        const isbnMatch = /(?:isbn[:\s]*)?(\d[\d\-X]+)/.exec(idText);
        if (isbnMatch) {
          record.isbn = isbnMatch[1];
        }
      }
      // Extract ISSN
      else if (idText.includes('issn')) {
        const issnMatch = /(?:issn[:\s]*)?(\d{4}-\d{3}[\dX])/.exec(idText);
        if (issnMatch) {
          record.issn = issnMatch[1];
        }
      }
      // Extract DOI
      else if (idText.includes('doi') || idText.includes('doi.org')) {
        const doiMatch = /(?:doi[:\s]*)?(?:https?:\/\/doi\.org\/)?(\d+\.\d+\/[^\s]+)/.exec(idText);
        if (doiMatch) {
          record.doi = doiMatch[1];
        }
      }
      // Extract URL
      else if (idText.startsWith('http')) {
        record.urls.push(idText);
      }
    }
    
    // Find subjects
    const subjectElements = this.findElements(element, './/dc:subject');
    for (const elem of subjectElements) {
      if (elem.textContent?.trim()) {
        record.subjects.push(elem.textContent.trim());
      }
    }
    
    // Find description (abstract)
    const descriptionElement = this.findElement(element, './/dc:description');
    if (descriptionElement?.textContent) {
      record.abstract = descriptionElement.textContent.trim();
    }
    
    // Find language
    const languageElement = this.findElement(element, './/dc:language');
    if (languageElement?.textContent) {
      record.language = languageElement.textContent.trim();
    }
    
    // Find format
    const formatElement = this.findElement(element, './/dc:format');
    if (formatElement?.textContent) {
      record.format = formatElement.textContent.trim();
    }
    
    // Find source (could contain journal or book info)
    const sourceElement = this.findElement(element, './/dc:source');
    if (sourceElement?.textContent) {
      const source = sourceElement.textContent.trim();
      
      // Check for journal pattern
      // Check for journal pattern
    const journalMatch = /([^,]+),\s*(?:Vol(?:ume)?\.?\s*(\d+))?,?\s*(?:No\.?\s*(\d+))?,?\s*(?:pp\.?\s*(\d+(?:-\d+)?))?/.exec(source);
    if (journalMatch) {
      record.journal_title = journalMatch[1]?.trim();
      record.volume = journalMatch[2];
      record.issue = journalMatch[3];
      record.pages = journalMatch[4];
    }
    // If not journal, might be a book chapter or series
    else if (/in:/.test(source.toLowerCase()) || /in /.test(source.toLowerCase())) {
      const bookMatch = /(?:in:?|In:?)\s*([^,]+)/.exec(source);
      if (bookMatch) {
        record.series = bookMatch[1]?.trim();
      }
    }
  }
  
  // Determine document type from available info
  if (record.journal_title && (record.volume || record.issue)) {
    record.document_type = "Journal Article";
  } else if (record.series) {
    record.document_type = "Book Chapter";
  } else if (record.format?.toLowerCase().includes('book')) {
    record.document_type = "Book";
  }
  
  return record;
}

  /**
 * Parse source string for journal information
 */
private parseSourceString(source: string): { 
  journal_title?: string; 
  volume?: string; 
  issue?: string; 
  pages?: string;
  series?: string; 
} {
  const result: {
    journal_title?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    series?: string;
  } = {};
  
  // Check for journal pattern like "Journal Name, Vol. X, No. Y, pp. Z-W"
  const journalMatch = /([^,]+),\s*(?:Vol(?:ume)?\.?\s*(\d+))?,?\s*(?:No\.?\s*(\d+))?,?\s*(?:pp\.?\s*(\d+(?:-\d+)?))?/.exec(source);
  if (journalMatch) {
    result.journal_title = journalMatch[1]?.trim();
    result.volume = journalMatch[2];
    result.issue = journalMatch[3];
    result.pages = journalMatch[4];
    return result;
  }
  
  // If not journal, might be a book chapter or series
  if (/in:/.test(source.toLowerCase()) || /in /.test(source.toLowerCase())) {
    const bookMatch = /(?:in:?|In:?)\s*([^,]+)/.exec(source);
    if (bookMatch) {
      result.series = bookMatch[1]?.trim();
    }
  }
  
  return result;
}

/**
 * Parse MARCXML formatted records
 */
private parseMarcXml(
  element: Element, 
  recordId: string,
  rawXml?: string
): BiblioRecord {
  // Initialize record with default values
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
    schema: 'marcxml'
  };
  
  // Find record element (could be nested)
  let marcRecord = element;
  
  // Find title (MARC field 245 subfield a)
  let title = "Untitled";
  
  const titleFields = this.findDatafields(marcRecord, "245", "a");
  if (titleFields.length > 0) {
    title = titleFields[0].replace(/[\/:]$/, '').trim();
  }
  
  // Find subtitle if present (245 subfield b)
  const subtitleFields = this.findDatafields(marcRecord, "245", "b");
  if (subtitleFields.length > 0) {
    title += ": " + subtitleFields[0].trim();
  }
  
  record.title = title;
  
  // Keep track of seen names to avoid duplicates
  const seenNames = new Set<string>();
  
  // Creator (100) - Main author
  const creatorFields = this.findDatafieldElements(marcRecord, "100");
  for (const field of creatorFields) {
    const nameSubfield = this.findSubfield(field, "a");
    if (!nameSubfield) continue;
    
    const name = nameSubfield.textContent?.trim() || '';
    if (!name) continue;
    
    // Check for role in subfield e
    const roleSubfield = this.findSubfield(field, "e");
    const role = roleSubfield?.textContent?.trim().toLowerCase() || '';
    
    if (role) {
      if (/edit|hrsg|hg/.test(role)) {
        if (!seenNames.has(name)) {
          record.editors.push(name);
          seenNames.add(name);
        }
      } else if (/transl|übers/.test(role)) {
        if (!seenNames.has(name)) {
          record.translators.push(name);
          seenNames.add(name);
        }
      } else {
        // Other contributor role
        if (!seenNames.has(name)) {
          record.contributors.push({ name, role });
          seenNames.add(name);
        }
      }
    } else {
      // No specific role, assume author
      if (!seenNames.has(name)) {
        record.authors.push(name);
        seenNames.add(name);
      }
    }
  }
  
  // Contributors (700) - Added authors, editors, etc.
  const contributorFields = this.findDatafieldElements(marcRecord, "700");
  for (const field of contributorFields) {
    const nameSubfield = this.findSubfield(field, "a");
    if (!nameSubfield) continue;
    
    const name = nameSubfield.textContent?.trim() || '';
    if (!name) continue;
    
    // Check for role in subfield e
    const roleSubfield = this.findSubfield(field, "e");
    const role = roleSubfield?.textContent?.trim().toLowerCase() || '';
    
    if (role) {
      if (/edit|hrsg|hg/.test(role)) {
        if (!seenNames.has(name)) {
          record.editors.push(name);
          seenNames.add(name);
        }
      } else if (/transl|übers/.test(role)) {
        if (!seenNames.has(name)) {
          record.translators.push(name);
          seenNames.add(name);
        }
      } else {
        // Other contributor role
        if (!seenNames.has(name)) {
          record.contributors.push({ name, role });
          seenNames.add(name);
        }
      }
    } else {
      // No specific role, assume author/contributor
      if (!seenNames.has(name)) {
        record.authors.push(name);
        seenNames.add(name);
      }
    }
  }
  
  // Find year (MARC field, 260/264 subfield c)
  for (const tag of ["260", "264"]) {
    const dateFields = this.findDatafields(marcRecord, tag, "c");
    if (dateFields.length > 0) {
      const dateText = dateFields[0];
      // Extract year
      const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
      if (yearMatch) {
        record.year = yearMatch[1];
        break;
      }
    }
  }
  
  // Find publisher (MARC field 260/264 subfield b)
  for (const tag of ["260", "264"]) {
    const publisherFields = this.findDatafields(marcRecord, tag, "b");
    if (publisherFields.length > 0) {
      record.publisher_name = publisherFields[0].replace(/[,:]$/, '').trim();
      break;
    }
  }
  
  // Find place of publication (MARC field 260/264 subfield a)
  for (const tag of ["260", "264"]) {
    const placeFields = this.findDatafields(marcRecord, tag, "a");
    if (placeFields.length > 0) {
      record.place_of_publication = placeFields[0].replace(/:$/, '').trim();
      break;
    }
  }
  
  // Find ISBN (MARC field 020 subfield a)
  const isbnFields = this.findDatafields(marcRecord, "020", "a");
  if (isbnFields.length > 0) {
    const isbnText = isbnFields[0];
    // Extract just the ISBN part
    const isbnMatch = /(\d[\d\-X]+)/.exec(isbnText);
    if (isbnMatch) {
      record.isbn = isbnMatch[1];
    } else {
      record.isbn = isbnText;
    }
  }
  
  // Find ISSN (MARC field 022 subfield a)
  const issnFields = this.findDatafields(marcRecord, "022", "a");
  if (issnFields.length > 0) {
    record.issn = issnFields[0];
  }
  
  // Find DOI (MARC field 024 with indicator 7 and subfield 2 = doi)
  const doiFields = this.findDatafieldElements(marcRecord, "024", "7");
  for (const field of doiFields) {
    const subfield2 = this.findSubfield(field, "2");
    if (subfield2?.textContent?.trim().toLowerCase() === "doi") {
      const subfieldA = this.findSubfield(field, "a");
      if (subfieldA?.textContent) {
        record.doi = subfieldA.textContent.trim();
        break;
      }
    }
  }
  
  // Find subjects (MARC fields 650, 651)
  for (const tag of ["650", "651"]) {
    const subjectFields = this.findDatafields(marcRecord, tag, "a");
    record.subjects.push(...subjectFields);
  }
  
  // Find language (MARC field 041 subfield a)
  const languageFields = this.findDatafields(marcRecord, "041", "a");
  if (languageFields.length > 0) {
    record.language = languageFields[0];
  }
  
  // Find series (MARC field 490 or 830)
  const seriesFields = this.findDatafields(marcRecord, "490", "a") || 
                      this.findDatafields(marcRecord, "830", "a");
  if (seriesFields.length > 0) {
    record.series = seriesFields[0];
  }
  
  // Find extent/pagination (MARC field 300 subfield a)
  const extentFields = this.findDatafields(marcRecord, "300", "a");
  if (extentFields.length > 0) {
    record.extent = extentFields[0];
    
    // Extract page information from extent
    const pageMatch = /(\d+)(?:\s*[-–]\s*(\d+))?\s*p/.exec(record.extent);
    if (pageMatch) {
      if (pageMatch[2]) { // Range of pages
        record.pages = `${pageMatch[1]}-${pageMatch[2]}`;
      } else { // Single page count
        record.pages = pageMatch[1];
      }
    }
  }
  
  // Find edition (MARC field 250 subfield a)
  const editionFields = this.findDatafields(marcRecord, "250", "a");
  if (editionFields.length > 0) {
    record.edition = editionFields[0];
  }
  
  // Find URLs (MARC field 856 subfield u)
  const urlFields = this.findDatafields(marcRecord, "856", "u");
  record.urls = urlFields;
  
  // Check if this is a journal article (MARC field 773)
  const hostItemFields = this.findDatafieldElements(marcRecord, "773");
  for (const field of hostItemFields) {
    // Title of host item (journal or book title)
    const titleSubfield = this.findSubfield(field, "t");
    if (titleSubfield?.textContent) {
      const hostTitle = titleSubfield.textContent.trim();
      
      // Check if this is a journal reference
      const gSubfield = this.findSubfield(field, "g");
      if (gSubfield?.textContent) {
        const volText = gSubfield.textContent.trim();
        // Check if this looks like a journal reference
        if (/vol|issue|number|no\.|band/i.test(volText)) {
          record.journal_title = hostTitle;
          
          // Extract volume/issue from text like "vol. 10, no. 3, p. 45-67"
          const volMatch = /vol(?:ume)?\.?\s*(\d+)/i.exec(volText);
          if (volMatch) {
            record.volume = volMatch[1];
          }
          
          const issueMatch = /(?:no|issue|num)\.?\s*(\d+)/i.exec(volText);
          if (issueMatch) {
            record.issue = issueMatch[1];
          }
          
          // Extract page range
          const pageMatch = /p(?:age)?s?\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(volText);
          if (pageMatch) {
            if (pageMatch[2]) { // Range
              record.pages = `${pageMatch[1]}-${pageMatch[2]}`;
            } else { // Single page
              record.pages = pageMatch[1];
            }
          }
        } else {
          // Likely a book chapter - use series field
          record.series = hostTitle;
        }
      }
    }
  }
  
  // Determine document type
  const leader = this.findLeader(marcRecord);
  if (leader && leader.length >= 8) {
    const materialType = leader[6];
    const biblioLevel = leader[7];
    
    if (materialType === 'a' && biblioLevel === 's') {
      record.document_type = 'Journal';
    } else if (materialType === 'a' && biblioLevel === 'm') {
      record.document_type = 'Book';
    } else if (materialType === 'a' && biblioLevel === 'a') {
      record.document_type = 'Journal Article';
    } else if (materialType === 'a' && biblioLevel === 'c') {
      record.document_type = 'Book Chapter';
    } else if (materialType === 'e') {
      record.document_type = 'Map';
    } else if (materialType === 'g') {
      record.document_type = 'Video';
    } else if (materialType === 'j') {
      record.document_type = 'Music';
    } else if (materialType === 'k') {
      record.document_type = 'Image';
    } else if (materialType === 'm') {
      record.document_type = 'Computer File';
    }
  } else if (record.journal_title) {
    record.document_type = 'Journal Article';
  } else if (record.issn) {
    record.document_type = 'Journal';
  } else if (record.isbn) {
    record.document_type = 'Book';
  }
  
  record.format = record.document_type;
  
  return record;
}

/**
 * Generic record parser for when no specific parser is available
 */
private parseGeneric(
  element: Element, 
  recordId: string,
  rawXml?: string
): BiblioRecord {
  // Initialize record with default values
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
    schema: 'generic'
  };
  
  // Try to find title using various possible paths
  const titlePaths = [
    './/dc:title', 
    './/dcterms:title',
    './/title',
    './/marc:datafield[@tag="245"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="245"]/mxc:subfield[@code="a"]'
  ];
  
  for (const path of titlePaths) {
    const titleElement = this.findElement(element, path);
    if (titleElement?.textContent) {
      record.title = titleElement.textContent.trim();
      break;
    }
  }
  
  // Try to find authors
  const seenNames = new Set<string>();
  
  // Extract creators/authors
  const authorPaths = [
    './/dc:creator',
    './/dcterms:creator',
    './/creator',
    './/marc:datafield[@tag="100"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="100"]/mxc:subfield[@code="a"]',
    './/marc:datafield[@tag="700"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="700"]/mxc:subfield[@code="a"]'
  ];
  
  for (const path of authorPaths) {
    const authorElements = this.findElements(element, path);
    for (const elem of authorElements) {
      if (!elem.textContent) continue;
      
      const name = elem.textContent.trim();
      if (!name) continue;
      
      // Check if it's an editor
      if (/\b(?:ed(?:itor)?|hrsg|hg)\b/i.test(name) || 
          /\(ed/i.test(name) || 
          /\(hg/i.test(name) || 
          /\(hg\.\)/i.test(name)) {
        
        // Clean editor name
        const cleanName = name
          .replace(/\s*[\(\[][^)]*(?:ed|hrsg|edit|hg)[^)]*[\)\]]/g, '')
          .replace(/\s*(?:ed|hrsg|edit|hg)\.?(?:\s+|$)/g, '')
          .trim();
        
        if (cleanName && !seenNames.has(cleanName)) {
          record.editors.push(cleanName);
          seenNames.add(cleanName);
        }
        continue;
      }
      
      // Check if it's a translator
      if (/\b(?:trans|transl|translator|übersetz|übers)\b/i.test(name)) {
        // Clean translator name
        const cleanName = name
          .replace(/\s*[\(\[][^)]*(?:trans|übersetz)[^)]*[\)\]]/g, '')
          .replace(/\s*(?:trans|transl|translator|übersetz|übers)\.?(?:\s+|$)/g, '')
          .trim();
        
        if (cleanName && !seenNames.has(cleanName)) {
          record.translators.push(cleanName);
          seenNames.add(cleanName);
        }
        continue;
      }
      
      // Regular author
      if (!seenNames.has(name)) {
        record.authors.push(name);
        seenNames.add(name);
      }
    }
  }
  
  // Try to find year
  const yearPaths = [
    './/dc:date',
    './/dcterms:date',
    './/dcterms:issued',
    './/date',
    './/marc:datafield[@tag="260"]/marc:subfield[@code="c"]',
    './/mxc:datafield[@tag="260"]/mxc:subfield[@code="c"]',
    './/marc:datafield[@tag="264"]/marc:subfield[@code="c"]',
    './/mxc:datafield[@tag="264"]/mxc:subfield[@code="c"]'
  ];
  
  for (const path of yearPaths) {
    const yearElement = this.findElement(element, path);
    if (yearElement?.textContent) {
      const dateText = yearElement.textContent.trim();
      // Extract year
      const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
      if (yearMatch) {
        record.year = yearMatch[1];
        break;
      }
    }
  }
  
  // Try to find publisher
  const publisherPaths = [
    './/dc:publisher',
    './/dcterms:publisher',
    './/publisher',
    './/marc:datafield[@tag="260"]/marc:subfield[@code="b"]',
    './/mxc:datafield[@tag="260"]/mxc:subfield[@code="b"]',
    './/marc:datafield[@tag="264"]/marc:subfield[@code="b"]',
    './/mxc:datafield[@tag="264"]/mxc:subfield[@code="b"]'
  ];
  
  for (const path of publisherPaths) {
    const publisherElement = this.findElement(element, path);
    if (publisherElement?.textContent) {
      record.publisher_name = publisherElement.textContent
        .replace(/[,:]$/, '')
        .trim();
      break;
    }
  }
  
  // Try to find place of publication
  const placePaths = [
    './/marc:datafield[@tag="260"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="260"]/mxc:subfield[@code="a"]',
    './/marc:datafield[@tag="264"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="264"]/mxc:subfield[@code="a"]'
  ];
  
  for (const path of placePaths) {
    const placeElement = this.findElement(element, path);
    if (placeElement?.textContent) {
      record.place_of_publication = placeElement.textContent
        .replace(/[,:]$/, '')
        .trim();
      break;
    }
  }
  
  // Try to find ISBN
  const isbnPaths = [
    './/bibo:isbn13',
    './/bibo:isbn10',
    './/bibo:isbn',
    './/bibo:gtin14',
    './/dc:identifier[contains(text(), "ISBN")]',
    './/marc:datafield[@tag="020"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="020"]/mxc:subfield[@code="a"]'
  ];
  
  for (const path of isbnPaths) {
    const isbnElement = this.findElement(element, path);
    if (isbnElement?.textContent) {
      const isbnText = isbnElement.textContent.trim();
      // Extract ISBN
      const isbnMatch = /(?:ISBN[:\s]*)?(\d[\d\-X]+)/.exec(isbnText);
      if (isbnMatch) {
        record.isbn = isbnMatch[1];
        break;
      } else {
        record.isbn = isbnText;
        break;
      }
    }
  }
  
  // Try to find ISSN
  const issnPaths = [
    './/bibo:issn',
    './/dc:identifier[contains(text(), "ISSN")]',
    './/marc:datafield[@tag="022"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="022"]/mxc:subfield[@code="a"]'
  ];
  
  for (const path of issnPaths) {
    const issnElement = this.findElement(element, path);
    if (issnElement?.textContent) {
      const issnText = issnElement.textContent.trim();
      // Extract ISSN
      const issnMatch = /(?:ISSN[:\s]*)?(\d{4}-\d{3}[\dX])/.exec(issnText);
      if (issnMatch) {
        record.issn = issnMatch[1];
        break;
      } else {
        record.issn = issnText;
        break;
      }
    }
  }
  
  // Try to find URLs
  const urlPaths = [
    './/foaf:primaryTopic',
    './/umbel:isLike',
    './/dc:identifier[contains(text(), "http")]',
    './/marc:datafield[@tag="856"]/marc:subfield[@code="u"]',
    './/mxc:datafield[@tag="856"]/mxc:subfield[@code="u"]'
  ];
  
  for (const path of urlPaths) {
    const urlElements = this.findElements(element, path);
    for (const elem of urlElements) {
      const resourceAttr = this.getResourceAttribute(elem);
      if (resourceAttr && resourceAttr.startsWith('http')) {
        record.urls.push(resourceAttr);
      } else if (elem.textContent && elem.textContent.trim().startsWith('http')) {
        record.urls.push(elem.textContent.trim());
      }
    }
  }
  
  // Try to find subjects
  const subjectPaths = [
    './/dc:subject',
    './/dcterms:subject',
    './/marc:datafield[@tag="650"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="650"]/marc:subfield[@code="a"]',
    './/marc:datafield[@tag="651"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="651"]/marc:subfield[@code="a"]',
    './/marc:datafield[@tag="653"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="653"]/marc:subfield[@code="a"]'
  ];
  
  for (const path of subjectPaths) {
    const subjectElements = this.findElements(element, path);
    for (const elem of subjectElements) {
      if (elem.textContent?.trim()) {
        record.subjects.push(elem.textContent.trim());
      }
    }
  }
  
  // Try to find abstract/description
  const abstractPaths = [
    './/dc:description',
    './/dcterms:abstract',
    './/marc:datafield[@tag="520"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="520"]/marc:subfield[@code="a"]'
  ];
  
  for (const path of abstractPaths) {
    const abstractElement = this.findElement(element, path);
    if (abstractElement?.textContent) {
      record.abstract = abstractElement.textContent.trim();
      break;
    }
  }
  
  // Try to find language
  const languagePaths = [
    './/dc:language',
    './/dcterms:language',
    './/marc:datafield[@tag="041"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="041"]/mxc:subfield[@code="a"]'
  ];
  
  for (const path of languagePaths) {
    const languageElement = this.findElement(element, path);
    if (languageElement?.textContent) {
      record.language = languageElement.textContent.trim();
      break;
    }
  }
  
  // Try to find series
  const seriesPaths = [
    './/marc:datafield[@tag="490"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="490"]/marc:subfield[@code="a"]',
    './/marc:datafield[@tag="830"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="830"]/marc:subfield[@code="a"]'
  ];
  
  for (const path of seriesPaths) {
    const seriesElement = this.findElement(element, path);
    if (seriesElement?.textContent) {
      record.series = seriesElement.textContent.trim();
      break;
    }
  }
  
  // Try to find edition
  const editionPaths = [
    './/marc:datafield[@tag="250"]/marc:subfield[@code="a"]',
    './/mxc:datafield[@tag="250"]/marc:subfield[@code="a"]'
  ];
  
  for (const path of editionPaths) {
    const editionElement = this.findElement(element, path);
    if (editionElement?.textContent) {
      record.edition = editionElement.textContent.trim();
      break;
    }
  }
  
  return record;
}

/**
 * Helper function to parse RDFxml formatted records (e.g. from DNB)
 */
private parseRdfXml(
  element: Element, 
  recordId: string,
  rawXml?: string
): BiblioRecord {
  // This is a simplified version as RDF parsing is more complex
  // For a full implementation, see the Python version

  // Initialize record with default values
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
    schema: 'RDFxml'
  };
  
  // Find description element
  const desc = this.findElement(element, './/rdf:Description');
  if (!desc) {
    console.warn(`No RDF:Description found in record ${recordId}`);
    return record;
  }
  
  // Find title
  const titleElement = this.findElement(desc, './dc:title');
  if (titleElement?.textContent) {
    record.title = titleElement.textContent.trim();
  }
  
  // Find subtitle
  const subtitleElement = this.findElement(desc, './rdau:P60493');
  if (subtitleElement?.textContent && !record.title.includes(':')) {
    record.title = `${record.title}: ${subtitleElement.textContent.trim()}`;
  }
  
  // Process name extraction
  const seenNames = new Set<string>();
  
  // Helper function to clean and categorize names
  const processNameWithRole = (name: string | null | undefined): {
    cleanName: string | null;
    role: string;
    isDuplicate: boolean;
  } => {
    if (!name) return { cleanName: null, role: 'author', isDuplicate: true };
    
    name = name.trim();
    if (!name) return { cleanName: null, role: 'author', isDuplicate: true };
    
    // Detect editor patterns
    const isEditor = /\([Hh]g\.?\)|\([Hh]rsg\.?\)|\([Ee]d\.?\)|\([Ee]ditor[s]?\)|\b[Hh]g\.|\b[Hh]rsg\.|\b[Ee]d\.|\b[Ee]ditor[s]?\b|[,\s]+[Hh]g\.|[,\s]+[Hh]rsg\.|[,\s]+[Ee]d\.|[,\s]+[Ee]ditor[s]?/.test(name);
    
    // Detect translator patterns
    const isTranslator = /\([Üü]bers\.?\)|\([Tt]rans\.?\)|\([Tt]ranslator[s]?\)|\b[Üü]bers\.|\b[Tt]rans\.|\b[Tt]ranslator[s]?\b|[,\s]+[Üü]bers\.|[,\s]+[Tt]rans\.|[,\s]+[Tt]ranslator[s]?/.test(name);
    
    // Determine role
    let role = 'author';
    if (isEditor) {
      role = 'editor';
    } else if (isTranslator) {
      role = 'translator';
    }
    
    // Clean the name by removing role designations
    let cleanName = name;
    
    if (isEditor) {
      // Remove editor designations
      cleanName = cleanName
        .replace(/\([Hh]g\.?\)/g, '')
        .replace(/\([Hh]rsg\.?\)/g, '')
        .replace(/\([Ee]d\.?\)/g, '')
        .replace(/\([Ee]ditor[s]?\)/g, '')
        .replace(/\b[Hh]g\./g, '')
        .replace(/\b[Hh]rsg\./g, '')
        .replace(/\b[Ee]d\./g, '')
        .replace(/\b[Ee]ditor[s]?\b/g, '')
        .replace(/[,\s]+[Hh]g\./g, '')
        .replace(/[,\s]+[Hh]rsg\./g, '')
        .replace(/[,\s]+[Ee]d\./g, '')
        .replace(/[,\s]+[Ee]ditor[s]?/g, '');
    }
    
    if (isTranslator) {
      // Remove translator designations
      cleanName = cleanName
        .replace(/\([Üü]bers\.?\)/g, '')
        .replace(/\([Tt]rans\.?\)/g, '')
        .replace(/\([Tt]ranslator[s]?\)/g, '')
        .replace(/\b[Üü]bers\./g, '')
        .replace(/\b[Tt]rans\./g, '')
        .replace(/\b[Tt]ranslator[s]?\b/g, '')
        .replace(/[,\s]+[Üü]bers\./g, '')
        .replace(/[,\s]+[Tt]rans\./g, '')
        .replace(/[,\s]+[Tt]ranslator[s]?/g, '');
    }
    
    // Clean up remaining punctuation/whitespace
    cleanName = cleanName
      .replace(/\(\s*\)/g, '')       // Empty parentheses
      .replace(/\s+/g, ' ')          // Multiple spaces
      .replace(/[\s,;:\.]+$/g, '')   // Trailing punctuation/whitespace
      .replace(/^[\s,;:\.]+/g, '')   // Leading punctuation/whitespace
      .trim();
    
    if (!cleanName) {
      return { cleanName: null, role, isDuplicate: true };
    }
    
    // Check if this is a duplicate
    const isDuplicate = seenNames.has(cleanName);
    if (!isDuplicate) {
      seenNames.add(cleanName);
    }
    
    return { cleanName, role, isDuplicate };
  };
  
  // Process P60327 field (contributor statement)
  const contributorStatement = this.findElement(desc, './rdau:P60327');
  if (contributorStatement?.textContent) {
    const statement = contributorStatement.textContent.trim();
    
    // Check for editorial patterns
    if (statement.includes("herausgegeben von")) {
      // Extract editors from the editorial statement
      const editorMatch = /herausgegeben von\s+(.+?)(?:;|$)/.exec(statement);
      if (editorMatch?.[1]) {
        const editorsText = editorMatch[1].trim();
        // Split by "und" or "and" or commas
        const editorNames = editorsText.split(/\s+(?:und|and)\s+|,\s*/);
        for (const name of editorNames) {
          const { cleanName, isDuplicate } = processNameWithRole(name);
          if (cleanName && !isDuplicate) {
            record.editors.push(cleanName);
          }
        }
      }
    }
    
    // Look for translator patterns
    if (statement.includes("Übers.") || statement.includes("Übertragung") || statement.includes("übersetzt")) {
      // Extract translators
      const transMatch = /(?:Übers|Übertragung|übersetzt)[^:]*[:\.]\s*([^\.]+)/.exec(statement);
      if (transMatch?.[1]) {
        const translatorText = transMatch[1].trim();
        const transNames = translatorText.split(/\s+(?:und|and)\s+|,\s*/);
        for (const name of transNames) {
          const { cleanName, isDuplicate } = processNameWithRole(name);
          if (cleanName && !isDuplicate) {
            record.translators.push(cleanName);
          }
        }
      }
    }
  }
  
  // Extract authors from creator elements
  for (const creatorPath of ['./dcterms:creator', './dc:creator']) {
    const creatorElements = this.findElements(desc, creatorPath);
    for (const creator of creatorElements) {
      // Check for resource reference
      const resource = this.getResourceAttribute(creator);
      if (resource) {
        const creatorDesc = this.findElement(element, `.//rdf:Description[@rdf:about="${resource}"]`);
        if (creatorDesc) {
          const nameElem = this.findElement(creatorDesc, './gndo:preferredName');
          if (nameElem?.textContent) {
            const { cleanName, role, isDuplicate } = processNameWithRole(nameElem.textContent);
            if (cleanName && !isDuplicate) {
              if (role === 'editor') {
                record.editors.push(cleanName);
              } else if (role === 'translator') {
                record.translators.push(cleanName);
              } else {
                record.authors.push(cleanName);
              }
            }
          }
        }
        continue;
      }
      
      // Direct text content
      if (creator.textContent) {
        const { cleanName, role, isDuplicate } = processNameWithRole(creator.textContent);
        if (cleanName && !isDuplicate) {
          if (role === 'editor') {
            record.editors.push(cleanName);
          } else if (role === 'translator') {
            record.translators.push(cleanName);
          } else {
            record.authors.push(cleanName);
          }
        }
      }
    }
  }
  
  // Find year
  const issuedElement = this.findElement(desc, './dcterms:issued');
  if (issuedElement?.textContent) {
    const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(issuedElement.textContent);
    if (yearMatch) {
      record.year = yearMatch[1];
    }
  }
  
  // Find publisher
  const publisherElement = this.findElement(desc, './dc:publisher');
  if (publisherElement?.textContent) {
    record.publisher_name = publisherElement.textContent.trim();
  }
  
  // Find place of publication (using rdau:P60163)
  const places: string[] = [];
  const placeElements = this.findElements(desc, './rdau:P60163');
  for (const place of placeElements) {
    if (place.textContent?.trim()) {
      places.push(place.textContent.trim());
    }
  }
  
  record.place_of_publication = places.join(", ");
  
  // Find publication statement (rdau:P60333)
  const pubStatement = this.findElement(desc, './rdau:P60333');
  if (pubStatement?.textContent) {
    const statement = pubStatement.textContent.trim();
    
    // If we don't have place or publisher, try to extract from statement
    if (!record.place_of_publication || !record.publisher_name) {
      const parts = statement.split(" : ", 2);
      if (parts.length > 1) {
        if (!record.place_of_publication) {
          record.place_of_publication = parts[0].trim();
        }
        if (!record.publisher_name) {
          let pubPart = parts[1].trim();
          pubPart = pubPart.replace(/,?\s*\[\d{4}\]$/, '');
          record.publisher_name = pubPart;
        }
      }
    }
  }
  
  // Find edition
  const editionElement = this.findElement(desc, './bibo:edition');
  if (editionElement?.textContent) {
    record.edition = editionElement.textContent.trim();
  }
  
  // Find extent (isbd:P1053)
  const extentElement = this.findElement(desc, './isbd:P1053') || 
                       this.findElement(desc, './dcterms:extent');
  if (extentElement?.textContent) {
    record.extent = extentElement.textContent.trim();
    
    // Try to extract page info from extent
    const pageMatch = /(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:p|pages|S)/i.exec(record.extent);
    if (pageMatch) {
      if (pageMatch[2]) { // Range
        record.pages = `${pageMatch[1]}-${pageMatch[2]}`;
      } else { // Single page count
        record.pages = pageMatch[1];
      }
    }
  }
  
  // Find document type
  const typeElement = this.findElement(desc, './dcterms:type') || 
                     this.findElement(desc, './dc:type');
  if (typeElement) {
    // Check for resource reference
    const resource = this.getResourceAttribute(typeElement);
    if (resource) {
      const typeParts = resource.split('/');
      if (typeParts.length > 0) {
        record.document_type = typeParts[typeParts.length - 1];
      }
    } else if (typeElement.textContent) {
      record.document_type = typeElement.textContent.trim();
    }
  }
  
  // Find ISBN (using bibo identifiers)
  for (const isbnField of ['isbn13', 'isbn10', 'isbn', 'gtin14']) {
    const isbnElement = this.findElement(desc, `./bibo:${isbnField}`);
    if (isbnElement?.textContent) {
      record.isbn = isbnElement.textContent.trim();
      break;
    }
  }
  
  // Find ISSN
  const issnElement = this.findElement(desc, './bibo:issn');
  if (issnElement?.textContent) {
    record.issn = issnElement.textContent.trim();
  }
  
  // Find DOI
  const doiElement = this.findElement(desc, './bibo:doi');
  if (doiElement?.textContent) {
    record.doi = doiElement.textContent.trim();
  }
  
  // Find subjects
  const seenSubjects = new Set<string>();
  const subjectElements = this.findElements(desc, './dcterms:subject');
  for (const subject of subjectElements) {
    const resource = this.getResourceAttribute(subject);
    if (resource) {
      const subjectValue = resource.split('/').pop() || '';
      if (subjectValue && !seenSubjects.has(subjectValue)) {
        record.subjects.push(subjectValue);
        seenSubjects.add(subjectValue);
      }
      continue;
    }
    
    if (subject.textContent?.trim() && !seenSubjects.has(subject.textContent.trim())) {
      record.subjects.push(subject.textContent.trim());
      seenSubjects.add(subject.textContent.trim());
    }
  }
  
  // Also check dc:subject
  const dcSubjectElements = this.findElements(desc, './dc:subject');
  for (const subject of dcSubjectElements) {
    if (subject.textContent?.trim() && !seenSubjects.has(subject.textContent.trim())) {
      record.subjects.push(subject.textContent.trim());
      seenSubjects.add(subject.textContent.trim());
    }
  }
  
  // Find language
  const languageElement = this.findElement(desc, './dcterms:language');
  if (languageElement) {
    const resource = this.getResourceAttribute(languageElement);
    if (resource) {
      record.language = resource.split('/').pop();
    } else if (languageElement.textContent) {
      record.language = languageElement.textContent.trim();
    }
  }
  
  // Find abstract
  for (const descTag of ['description', 'abstract']) {
    for (const nsPrefix of ['dc', 'dcterms']) {
      const abstractElement = this.findElement(desc, `./${nsPrefix}:${descTag}`);
      if (abstractElement?.textContent) {
        record.abstract = abstractElement.textContent.trim();
        break;
      }
    }
    if (record.abstract) break;
  }
  
  // Find URLs
  for (const primaryTopicElement of this.findElements(desc, './foaf:primaryTopic')) {
    const resource = this.getResourceAttribute(primaryTopicElement);
    if (resource?.startsWith('http') && !record.urls.includes(resource)) {
      record.urls.push(resource);
    }
  }
  
  for (const likeElement of this.findElements(desc, './umbel:isLike')) {
    const resource = this.getResourceAttribute(likeElement);
    if (resource?.startsWith('http') && !record.urls.includes(resource)) {
      record.urls.push(resource);
    }
  }
  
  // Find bibliographic citation
  const citationElement = this.findElement(desc, './dcterms:bibliographicCitation');
  if (citationElement?.textContent) {
    const citation = citationElement.textContent.trim();
    
    // Try to extract volume/issue/pages from citation
    if (!record.volume || !record.issue || !record.pages) {
      const volMatch = /[Vv]ol(?:ume)?\.?\s*(\d+)/.exec(citation);
      if (volMatch && !record.volume) {
        record.volume = volMatch[1];
      }
      
      const issueMatch = /(?:[Nn]o|[Ii]ssue|[Nn]um)\.?\s*(\d+)/.exec(citation);
      if (issueMatch && !record.issue) {
        record.issue = issueMatch[1];
      }
      
      const pageMatch = /(?:p|pp|[Pp]ages?)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/.exec(citation);
      if (pageMatch && !record.pages) {
        if (pageMatch[2]) { // Range
          record.pages = `${pageMatch[1]}-${pageMatch[2]}`;
        } else { // Single page
          record.pages = pageMatch[1];
        }
      }
    }
  }
  
  record.format = record.document_type;
  
  return record;
}


/**
     * Helper method to find a single XML element using XPath.
     * Accesses Node and XPathResult constants via the window object.
     */
    private findElement(contextNode: Document | Element, xpath: string): Element | null {
        try {
            const doc = contextNode.ownerDocument || (contextNode as Document);
            // Ensure the necessary properties exist on the window object
            const win = _globalThis.window2 as any; // Assuming window2 points to the main window
            if (!win || !win.Node || !win.XPathResult || !doc.evaluate) {
                 console.error("Required DOM/XPath features not found on window or document.");
                 return null;
            }

            const nsResolver = this.createNsResolver(doc);
            const result = doc.evaluate(
                xpath,
                contextNode,
                nsResolver,
                win.XPathResult.FIRST_ORDERED_NODE_TYPE, // Use window.XPathResult
                null
            );
            // Check nodeType before casting
            if (result.singleNodeValue && result.singleNodeValue.nodeType === win.Node.ELEMENT_NODE) {
                 return result.singleNodeValue as Element;
            }
            return null; // Return null if not an element or null
        } catch (e) {
            console.error(`Error evaluating XPath "${xpath}":`, e);
            return null;
        }
    }

    /**
     * Helper method to find multiple XML elements using XPath.
     * Accesses Node and XPathResult constants via the window object.
     */
    private findElements(contextNode: Document | Element, xpath: string): Element[] {
        const elements: Element[] = [];
        try {
            const doc = contextNode.ownerDocument || (contextNode as Document);
             // Ensure the necessary properties exist on the window object
            const win = _globalThis.window2 as any; // Assuming window2 points to the main window
            if (!win || !win.Node || !win.XPathResult || !doc.evaluate) {
                 console.error("Required DOM/XPath features not found on window or document.");
                 return [];
            }

            const nsResolver = this.createNsResolver(doc);
            const iterator = doc.evaluate(
                xpath,
                contextNode,
                nsResolver,
                win.XPathResult.ORDERED_NODE_ITERATOR_TYPE, // Use window.XPathResult
                null
            );

            let node = iterator.iterateNext();
            while (node) {
                // Check nodeType before adding
                if (node.nodeType === win.Node.ELEMENT_NODE) { // Use window.Node
                    elements.push(node as Element);
                }
                node = iterator.iterateNext();
            }
        } catch (e) {
            console.error(`Error evaluating XPath iterator "${xpath}":`, e);
        }
        return elements;
    }

/**
 * Helper for finding MARC datafields
 */
private findDatafields(element: Element, tag: string, code: string): string[] {
  const results: string[] = [];
  
  // Try with marc namespace
  const marcFields = this.findElements(element, `.//marc:datafield[@tag="${tag}"]`);
  for (const field of marcFields) {
    const subfields = this.findElements(field, `.//marc:subfield[@code="${code}"]`);
    for (const subfield of subfields) {
      if (subfield.textContent) {
        results.push(subfield.textContent.trim());
      }
    }
  }
  
  // Try with mxc namespace
  const mxcFields = this.findElements(element, `.//mxc:datafield[@tag="${tag}"]`);
  for (const field of mxcFields) {
    const subfields = this.findElements(field, `.//mxc:subfield[@code="${code}"]`);
    for (const subfield of subfields) {
      if (subfield.textContent) {
        results.push(subfield.textContent.trim());
      }
    }
  }
  
  // Try without namespace
  const plainFields = this.findElements(element, `datafield[tag="${tag}"]`);
  for (const field of plainFields) {
    const subfields = this.findElements(field, `subfield[code="${code}"]`);
    for (const subfield of subfields) {
      if (subfield.textContent) {
        results.push(subfield.textContent.trim());
      }
    }
  }
  
  return results;
}

/**
 * Helper for finding MARC datafield elements
 */
private findDatafieldElements(element: Element, tag: string, ind1?: string): Element[] {
  const results: Element[] = [];
  
  // Build the selector
  let marcSelector = `.//marc:datafield[@tag="${tag}"]`;
  let mxcSelector = `.//mxc:datafield[@tag="${tag}"]`;
  let plainSelector = `datafield[tag="${tag}"]`;
  
  if (ind1) {
    marcSelector += `[@ind1="${ind1}"]`;
    mxcSelector += `[@ind1="${ind1}"]`;
    plainSelector += `[ind1="${ind1}"]`;
  }
  
  // Try with marc namespace
  const marcFields = this.findElements(element, marcSelector);
  results.push(...marcFields);
  
  // Try with mxc namespace
  const mxcFields = this.findElements(element, mxcSelector);
  results.push(...mxcFields);
  
  // Try without namespace
  const plainFields = this.findElements(element, plainSelector);
  results.push(...plainFields);
  
  return results;
}

/**
 * Helper for finding a subfield in a MARC datafield
 */
private findSubfield(datafield: Element, code: string): Element | null {
  // Try with marc namespace
  let subfield = this.findElement(datafield, `.//marc:subfield[@code="${code}"]`);
  
  // Try with mxc namespace if not found
  if (!subfield) {
    subfield = this.findElement(datafield, `.//mxc:subfield[@code="${code}"]`);
  }
  
  // Try without namespace if still not found
  if (!subfield) {
    subfield = this.findElement(datafield, `subfield[code="${code}"]`);
  }
  
  return subfield;
}

/**
 * Helper for finding MARC leader element
 */
private findLeader(element: Element): string | null {
  // Try with marc namespace
  const marcLeader = this.findElement(element, './/marc:leader');
  if (marcLeader?.textContent) {
    return marcLeader.textContent;
  }
  
  // Try with mxc namespace
  const mxcLeader = this.findElement(element, './/mxc:leader');
  if (mxcLeader?.textContent) {
    return mxcLeader.textContent;
  }
  
  // Try without namespace
  const plainLeader = this.findElement(element, 'leader');
  if (plainLeader?.textContent) {
    return plainLeader.textContent;
  }
  
  return null;
}

/**
 * Helper to get RDF resource attribute
 */
private getResourceAttribute(element: Element): string | null {
  for (const prefix of ['rdf', '']) {
    const attr = element.getAttribute(`${prefix}:resource`) || 
                 element.getAttribute('resource');
    if (attr) return attr;
  }
  return null;
}
}