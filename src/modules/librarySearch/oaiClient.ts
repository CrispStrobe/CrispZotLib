// oaiClient.ts - OAI-PMH protocol client implementation

import { BiblioRecord } from './models';

// OAI-PMH Client class
export class OAIClient {
  // Public getter for baseUrl
  public get baseUrl(): string {
    return this._baseUrl;
  }

  private defaultMetadataPrefix: string;
  private timeout: number;
  private parser: DOMParser;
  
  constructor(
    private readonly _baseUrl: string,
    private readonly _defaultMetadataPrefix: string = 'oai_dc',
    private readonly _timeout: number = 30000
  ) {
    this.parser = new DOMParser();
    // this.baseUrl = _baseUrl;
    this.defaultMetadataPrefix = _defaultMetadataPrefix;
    this.timeout = _timeout;
  }
  /*
  constructor(
    baseUrl: string,
    defaultMetadataPrefix: string = 'oai_dc',
    timeout: number = 30000
  ) {
    this.baseUrl = baseUrl;
    this.defaultMetadataPrefix = defaultMetadataPrefix;
    this.timeout = timeout;
    this.parser = new DOMParser();
  }
  */
  
  /**
   * Build OAI-PMH request URL
   */
  buildUrl(verb: string, params: Record<string, string> = {}): string {
    const parameters = new URLSearchParams();
    parameters.append('verb', verb);
    
    // Add additional parameters
    for (const [key, value] of Object.entries(params)) {
      parameters.append(key, value);
    }
    
    // Construct URL
    if (this.baseUrl.includes('?')) {
      return `${this.baseUrl}&${parameters.toString()}`;
    } else {
      return `${this.baseUrl}?${parameters.toString()}`;
    }
  }
  
  /**
   * Identify the repository
   */
  async identify(): Promise<Record<string, string>> {
    try {
      const url = this.buildUrl('Identify');
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        },
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw new Error(`OAI request failed: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for errors
      const error = this.checkForErrors(xmlDoc);
      if (error) {
        return { error };
      }
      
      // Extract identification information
      const info: Record<string, string> = {};
      
      // Repository name
      const nameElem = xmlDoc.querySelector('repositoryName');
      if (nameElem?.textContent) {
        info.repositoryName = nameElem.textContent.trim();
      }
      
      // Base URL
      const baseUrlElem = xmlDoc.querySelector('baseURL');
      if (baseUrlElem?.textContent) {
        info.baseURL = baseUrlElem.textContent.trim();
      }
      
      // Protocol version
      const protoElem = xmlDoc.querySelector('protocolVersion');
      if (protoElem?.textContent) {
        info.protocolVersion = protoElem.textContent.trim();
      }
      
      // Admin email
      const emailElem = xmlDoc.querySelector('adminEmail');
      if (emailElem?.textContent) {
        info.adminEmail = emailElem.textContent.trim();
      }
      
      // Earliest datestamp
      const datestampElem = xmlDoc.querySelector('earliestDatestamp');
      if (datestampElem?.textContent) {
        info.earliestDatestamp = datestampElem.textContent.trim();
      }
      
      // Deletion mode
      const deletionElem = xmlDoc.querySelector('deletedRecord');
      if (deletionElem?.textContent) {
        info.deletedRecord = deletionElem.textContent.trim();
      }
      
      // Granularity
      const granularityElem = xmlDoc.querySelector('granularity');
      if (granularityElem?.textContent) {
        info.granularity = granularityElem.textContent.trim();
      }
      
      return info;
    } catch (e) {
      console.error('Error in OAI identify:', e);
      return { error: String(e) };
    }
  }
  
  /**
   * List metadata formats supported by the repository
   */
  async listMetadataFormats(): Promise<Array<Record<string, string>> | { error: string }> {
    try {
      const url = this.buildUrl('ListMetadataFormats');
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        },
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw new Error(`OAI request failed: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for errors
      const error = this.checkForErrors(xmlDoc);
      if (error) {
        return { error };
      }
      
      // Extract metadata format information
      const formats: Array<Record<string, string>> = [];
      const formatElements = xmlDoc.querySelectorAll('metadataFormat');
      
      for (const formatElem of formatElements) {
        const format: Record<string, string> = {};
        
        // Metadata prefix
        const prefixElem = formatElem.querySelector('metadataPrefix');
        if (prefixElem?.textContent) {
          format.metadataPrefix = prefixElem.textContent.trim();
        }
        
        // Schema
        const schemaElem = formatElem.querySelector('schema');
        if (schemaElem?.textContent) {
          format.schema = schemaElem.textContent.trim();
        }
        
        // Metadata namespace
        const nsElem = formatElem.querySelector('metadataNamespace');
        if (nsElem?.textContent) {
          format.metadataNamespace = nsElem.textContent.trim();
        }
        
        formats.push(format);
      }
      
      return formats;
    } catch (e) {
      console.error('Error in OAI listMetadataFormats:', e);
      return { error: String(e) };
    }
  }
  
  /**
   * List sets in the repository
   */
  async listSets(): Promise<Array<Record<string, string>> | { error: string } | { error: { code: string, message: string } }> {
    try {
      const url = this.buildUrl('ListSets');
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        },
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw new Error(`OAI request failed: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for errors
      const error = this.checkForErrors(xmlDoc);
      if (error) {
        // Special handling for noSetHierarchy error
        if (error.includes('noSetHierarchy')) {
          return { error: { code: 'noSetHierarchy', message: 'This repository does not support sets' } };
        }
        return { error };
      }
      
      // Extract set information
      const sets: Array<Record<string, string>> = [];
      const setElements = xmlDoc.querySelectorAll('set');
      
      for (const setElem of setElements) {
        const setInfo: Record<string, string> = {};
        
        // Set spec
        const specElem = setElem.querySelector('setSpec');
        if (specElem?.textContent) {
          setInfo.setSpec = specElem.textContent.trim();
        }
        
        // Set name
        const nameElem = setElem.querySelector('setName');
        if (nameElem?.textContent) {
          setInfo.setName = nameElem.textContent.trim();
        }
        
        sets.push(setInfo);
      }
      
      return sets;
    } catch (e) {
      console.error('Error in OAI listSets:', e);
      return { error: String(e) };
    }
  }
  
  /**
 * LibrarySearch TypeScript Implementation (Part 4)
 * 
 * Continuation of the OAI client and integration into the Zotero plugin
 */

// Continuing from the previous files...

  /**
   * Search the OAI-PMH repository
   */
  async search(
    query: Record<string, string> = {},
    metadataPrefix?: string,
    setSpec?: string,
    fromDate?: string,
    untilDate?: string,
    maxResults: number = 10
  ): Promise<[number, BiblioRecord[]]> {
    try {
      const actualMetadataPrefix = metadataPrefix || this.defaultMetadataPrefix;
      
      // Build parameters
      const params: Record<string, string> = {
        'metadataPrefix': actualMetadataPrefix
      };
      
      // Add set if specified
      if (setSpec) {
        params['set'] = setSpec;
      }
      
      // Add date range if specified
      if (fromDate) {
        params['from'] = fromDate;
      }
      
      if (untilDate) {
        params['until'] = untilDate;
      }
      
      // Collect results
      let allRecords: BiblioRecord[] = [];
      let resumptionToken: string | null = null;
      let totalRecords = 0;
      let batchSize = Math.min(100, maxResults);
      
      do {
        // For the first request, use ListRecords with our parameters
        // For subsequent requests, use resumptionToken
        let url: string;
        if (resumptionToken) {
          url = this.buildUrl('ListRecords', { resumptionToken });
        } else {
          url = this.buildUrl('ListRecords', params);
        }
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/xml'
          },
          signal: AbortSignal.timeout(this.timeout)
        });
        
        if (!response.ok) {
          throw new Error(`OAI request failed: ${response.status} ${response.statusText}`);
        }
        
        const xmlText = await response.text();
        const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
        
        // Check for errors
        const error = this.checkForErrors(xmlDoc);
        if (error) {
          console.error(`OAI error: ${error}`);
          break;
        }
        
        // Process records
        const recordElements = xmlDoc.querySelectorAll('record');
        let batchRecords: BiblioRecord[] = [];
        
        for (const recordElem of recordElements) {
          // Skip records marked as deleted
          const statusAttr = recordElem.getAttribute('status');
          if (statusAttr === 'deleted') {
            continue;
          }
          
          // Get header information
          const headerElem = recordElem.querySelector('header');
          const identifierElem = headerElem?.querySelector('identifier');
          const identifier = identifierElem?.textContent?.trim() || `record-${allRecords.length + batchRecords.length + 1}`;
          
          // Get metadata
          const metadataElem = recordElem.querySelector('metadata');
          if (!metadataElem) {
            continue;
          }
          
          // Parse record based on metadata prefix
          let record: BiblioRecord | null = null;
          
          // Get DC content if it exists
          const dcElem = metadataElem.querySelector('dc') || 
                         metadataElem.querySelector('oai_dc\\:dc') ||
                         metadataElem.querySelector('*|dc');
          
          if (dcElem) {
            record = this.parseDublinCore(dcElem, identifier);
          } else {
            // Generic parsing
            record = this.parseGeneric(metadataElem, identifier);
          }
          
          if (record) {
            // Filter results based on query if provided
            if (Object.keys(query).length > 0) {
              const matches = this.recordMatchesQuery(record, query);
              if (matches) {
                batchRecords.push(record);
              }
            } else {
              batchRecords.push(record);
            }
          }
          
          // Check if we've reached the desired number of results
          if (allRecords.length + batchRecords.length >= maxResults) {
            batchRecords = batchRecords.slice(0, maxResults - allRecords.length);
            break;
          }
        }
        
        // Add batch to overall results
        allRecords = [...allRecords, ...batchRecords];
        
        // Get resumption token for next batch
        const tokenElem = xmlDoc.querySelector('resumptionToken');
        resumptionToken = tokenElem?.textContent?.trim() || null;
        
        // Get completeListSize attribute if available
        if (tokenElem && tokenElem.getAttribute('completeListSize')) {
          totalRecords = parseInt(tokenElem.getAttribute('completeListSize') || '0', 10);
        } else if (totalRecords === 0) {
          // If we don't have a total yet, use what we've found so far
          totalRecords = allRecords.length;
        }
        
        // Stop if we've reached the max results or there's no resumption token
        if (allRecords.length >= maxResults || !resumptionToken) {
          break;
        }
      } while (resumptionToken);
      
      return [totalRecords || allRecords.length, allRecords];
    } catch (e) {
      console.error('Error in OAI search:', e);
      return [0, []];
    }
  }

  /**
   * Check if a record matches search criteria
   */
  private recordMatchesQuery(record: BiblioRecord, query: Record<string, string>): boolean {
    for (const [field, value] of Object.entries(query)) {
      if (!value) continue;
      
      const lowerValue = value.toLowerCase();
      
      switch (field) {
        case 'title':
          if (!record.title || !record.title.toLowerCase().includes(lowerValue)) {
            return false;
          }
          break;
        
        case 'author':
          if (!record.authors || !record.authors.some(a => a.toLowerCase().includes(lowerValue))) {
            return false;
          }
          break;
        
        case 'isbn':
          if (!record.isbn || !record.isbn.replace(/-/g, '').includes(value.replace(/-/g, ''))) {
            return false;
          }
          break;
        
        case 'issn':
          if (!record.issn || !record.issn.replace(/-/g, '').includes(value.replace(/-/g, ''))) {
            return false;
          }
          break;
        
        case 'year':
          if (!record.year || record.year !== value) {
            return false;
          }
          break;
        
        default:
          // Unknown field, ignore
          break;
      }
    }
    
    return true;
  }

  /**
   * Check for errors in OAI response
   */
  private checkForErrors(xmlDoc: Document): string | null {
    const errorElem = xmlDoc.querySelector('error');
    if (errorElem) {
      const code = errorElem.getAttribute('code') || 'unknown';
      const message = errorElem.textContent?.trim() || 'Unknown error';
      return `${code}: ${message}`;
    }
    return null;
  }

  /**
   * Parse Dublin Core record from OAI
   */
  private parseDublinCore(element: Element, recordId: string): BiblioRecord {
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
      schema: 'oai_dc'
    };
    
    // Get title
    const titleElements = element.querySelectorAll('title, dc\\:title, *|title');
    if (titleElements.length > 0 && titleElements[0].textContent) {
      record.title = titleElements[0].textContent.trim();
    }
    
    // Process creators (authors, editors, translators)
    const seenNames = new Set<string>();
    
    // Process creators
    const creatorElements = element.querySelectorAll('creator, dc\\:creator, *|creator');
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
    const contributorElements = element.querySelectorAll('contributor, dc\\:contributor, *|contributor');
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
    const dateElements = element.querySelectorAll('date, dc\\:date, *|date');
    if (dateElements.length > 0 && dateElements[0].textContent) {
      const dateText = dateElements[0].textContent.trim();
      // Extract year using regex
      const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
      if (yearMatch) {
        record.year = yearMatch[1];
      }
    }
    
    // Find publisher
    const publisherElements = element.querySelectorAll('publisher, dc\\:publisher, *|publisher');
    if (publisherElements.length > 0 && publisherElements[0].textContent) {
      record.publisher_name = publisherElements[0].textContent.trim();
    }
    
    // Find identifiers (ISBN, ISSN, DOI)
    const identifierElements = element.querySelectorAll('identifier, dc\\:identifier, *|identifier');
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
    const subjectElements = element.querySelectorAll('subject, dc\\:subject, *|subject');
    for (const elem of subjectElements) {
      if (elem.textContent?.trim()) {
        record.subjects.push(elem.textContent.trim());
      }
    }
    
    // Find description (abstract)
    const descriptionElements = element.querySelectorAll('description, dc\\:description, *|description');
    if (descriptionElements.length > 0 && descriptionElements[0].textContent) {
      record.abstract = descriptionElements[0].textContent.trim();
    }
    
    // Find language
    const languageElements = element.querySelectorAll('language, dc\\:language, *|language');
    if (languageElements.length > 0 && languageElements[0].textContent) {
      record.language = languageElements[0].textContent.trim();
    }
    
    // Find format
    const formatElements = element.querySelectorAll('format, dc\\:format, *|format');
    if (formatElements.length > 0 && formatElements[0].textContent) {
      record.format = formatElements[0].textContent.trim();
    }
    
    // Find source (could contain journal or book info)
    const sourceElements = element.querySelectorAll('source, dc\\:source, *|source');
    if (sourceElements.length > 0 && sourceElements[0].textContent) {
      const source = sourceElements[0].textContent.trim();
      
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
   * Generic record parser for OAI records
   */
  private parseGeneric(element: Element, recordId: string): BiblioRecord {
    // Initialize with minimal data
    const record: BiblioRecord = {
      id: recordId,
      title: `Record ${recordId}`,
      authors: [],
      editors: [],
      translators: [],
      contributors: [],
      urls: [],
      subjects: [],
      schema: 'generic'
    };
    
    // Serialize element for raw data
    const serializer = new XMLSerializer();
    record.raw_data = serializer.serializeToString(element);
    
    // Try to extract title using various possible elements
    const titleElements = element.querySelectorAll('title, *|title');
    if (titleElements.length > 0 && titleElements[0].textContent) {
      record.title = titleElements[0].textContent.trim();
    }
    
    // Try to extract creators/authors
    const creatorElements = element.querySelectorAll('creator, author, *|creator, *|author');
    for (const elem of creatorElements) {
      if (elem.textContent?.trim()) {
        record.authors.push(elem.textContent.trim());
      }
    }
    
    // Try to extract date/year
    const dateElements = element.querySelectorAll('date, year, *|date, *|year');
    if (dateElements.length > 0 && dateElements[0].textContent) {
      const dateText = dateElements[0].textContent.trim();
      // Extract year using regex
      const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
      if (yearMatch) {
        record.year = yearMatch[1];
      }
    }
    
    // URLs - look for elements with http in text content
    const allElements = element.querySelectorAll('*');
    for (const elem of allElements) {
      if (elem.textContent?.trim().startsWith('http')) {
        record.urls.push(elem.textContent.trim());
      }
    }
    
    return record;
  }
}