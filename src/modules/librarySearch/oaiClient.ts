// src/modules/librarySearch/oaiClient.ts
// OAI-PMH protocol client implementation - Fixed version

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
    this.defaultMetadataPrefix = _defaultMetadataPrefix;
    this.timeout = _timeout;
  }
  
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
   * Search for records with the given criteria
   * 
   * @param query Search terms for filtering (title, author, etc.)
   * @param metadataPrefix Metadata format to request
   * @param set_spec Optional set for filtering
   * @param from_date Optional start date (YYYY-MM-DD)
   * @param until_date Optional end date (YYYY-MM-DD)
   * @param max_results Maximum number of results to return
   * @returns Tuple of [total count, records]
   */
  async search(
    query: Record<string, string> = {},
    metadataPrefix: string = '',
    set_spec: string = '',
    from_date: string = '',
    until_date: string = '',
    max_results: number = 10
  ): Promise<[number, BiblioRecord[]]> {
    try {
      metadataPrefix = metadataPrefix || this.defaultMetadataPrefix;
      
      // For DNB and similar repositories that work better with date ranges and smaller chunks
      const is_dnb = this.baseUrl.toLowerCase().includes('dnb');
      
      // Handle repositories that require both from and until dates
      if (is_dnb) {
        // If searching DNB, we need both dates and small enough date ranges
        if (!until_date) {
          until_date = new Date().toISOString().split('T')[0]; // Today
          console.log(`Added missing until date for DNB search: ${until_date}`);
        }
        if (!from_date) {
          // Set from_date to a more limited period - 3 months is safer for DNB
          const untilDateObj = new Date(until_date);
          untilDateObj.setMonth(untilDateObj.getMonth() - 3);
          from_date = untilDateObj.toISOString().split('T')[0];
          console.log(`Added missing from date for DNB search: ${from_date}`);
        }
        
        // For DNB, try using a set when possible - this helps reduce result size
        if (!set_spec) {
          // Try using dnb:reiheA (new publications) as default
          set_spec = "dnb:reiheA";
          console.log(`Setting default DNB set: ${set_spec}`);
        }
        
        // IMPORTANT: For DNB, always use ListIdentifiers instead of ListRecords
        // then fetch individual records - this avoids 413 errors
        return await this.searchWithIdentifiers(
          query,
          metadataPrefix,
          set_spec,
          from_date,
          until_date,
          max_results
        );
      }
      
      // For other repositories, use normal approach
      return await this.searchWithRecords(
        query,
        metadataPrefix,
        set_spec,
        from_date,
        until_date,
        max_results
      );
    } catch (e) {
      console.error('Error in OAI search:', e);
      return [0, []];
    }
  }
  
  /**
   * Search using ListIdentifiers then GetRecord (for repositories like DNB)
   * This avoids 413 errors by using a 2-step process
   */
  private async searchWithIdentifiers(
    query: Record<string, string>,
    metadataPrefix: string,
    set_spec: string,
    from_date: string,
    until_date: string, 
    max_results: number
  ): Promise<[number, BiblioRecord[]]> {
    try {
      // Step 1: Get identifiers
      console.log("Using searchWithIdentifiers for DNB");
      const identifiers = await this.listIdentifiers(
        metadataPrefix,
        set_spec,
        from_date,
        until_date,
        100 // Get more identifiers than needed for filtering
      );
      
      console.log(`Found ${identifiers.length} identifiers`);
      
      if (identifiers.length === 0) {
        return [0, []];
      }
      
      // Step 2: Fetch individual records
      const records: BiblioRecord[] = [];
      const promises: Promise<BiblioRecord | null>[] = [];
      
      // Only fetch up to max_results records
      const toFetch = identifiers.slice(0, Math.min(identifiers.length, max_results * 3));
      
      for (const identifier of toFetch) {
        if (typeof identifier === 'string') {
          // Handle case where we just have the identifier string
          promises.push(this.getRecord(identifier, metadataPrefix));
        } else {
          // Handle case where we have an object with identifier property
          promises.push(this.getRecord(identifier.identifier, metadataPrefix));
        }
      }
      
      // Wait for all promises to resolve
      const fetchedRecords = await Promise.all(promises);
      
      // Filter out null records
      const validRecords = fetchedRecords.filter(record => record !== null) as BiblioRecord[];
      
      // Filter based on query
      const filteredRecords = validRecords.filter(record => this.record_matches_query(record, query));
      
      // Limit to max_results
      const finalRecords = filteredRecords.slice(0, max_results);
      
      return [validRecords.length, finalRecords];
    } catch (e) {
      console.error('Error in searchWithIdentifiers:', e);
      return [0, []];
    }
  }
  
  /**
   * Regular search approach using ListRecords
   */
  private async searchWithRecords(
    query: Record<string, string>,
    metadataPrefix: string,
    set_spec: string,
    from_date: string,
    until_date: string,
    max_results: number
  ): Promise<[number, BiblioRecord[]]> {
    try {
      // Get records with list_records
      const [totalCount, allRecords] = await this.list_records(
        metadataPrefix,
        set_spec,
        from_date,
        until_date,
        max_results
      );
      
      // Filter records if query parameters are provided
      let filteredRecords: BiblioRecord[] = [];
      
      if (Object.keys(query).length > 0) {
        for (const record of allRecords) {
          if (this.record_matches_query(record, query)) {
            filteredRecords.push(record);
            
            // Stop once we have enough matches
            if (filteredRecords.length >= max_results) {
              break;
            }
          }
        }
      } else {
        // No filtering needed
        filteredRecords = allRecords;
      }
      
      return [filteredRecords.length, filteredRecords];
    } catch (e) {
      console.error('Error in searchWithRecords:', e);
      return [0, []];
    }
  }

  /**
   * List record identifiers with optional filtering.
   */
  async listIdentifiers(
    metadata_prefix: string = '',
    set_spec: string = '',
    from_date: string = '',
    until_date: string = '',
    max_results: number = 100
  ): Promise<Array<any>> {
    try {
      metadata_prefix = metadata_prefix || this.defaultMetadataPrefix;
      
      // Build parameters
      const params: Record<string, string> = {
        'metadataPrefix': metadata_prefix
      };
      
      if (set_spec) {
        params['set'] = set_spec;
      }
      if (from_date) {
        params['from'] = from_date;
      }
      if (until_date) {
        params['until'] = until_date;
      }
      
      const url = this.buildUrl('ListIdentifiers', params);
      console.log(`Executing ListIdentifiers: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        }
      });
      
      if (!response.ok) {
        throw new Error(`OAI request failed: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for error
      const error = this.checkForErrors(xmlDoc);
      if (error) {
        console.error(`OAI-PMH error: ${error}`);
        if (error.includes('noRecordsMatch')) {
          return [];
        }
        return [{ error }];
      }
      
      // Extract identifiers
      const identifiers: Array<any> = [];
      const header_elements = xmlDoc.querySelectorAll('header');
      
      for (let i = 0; i < header_elements.length; i++) {
        if (max_results && i >= max_results) {
          break;
        }
        
        const header = header_elements[i];
        
        // Skip deleted records
        if (header.getAttribute('status') === 'deleted') {
          continue;
        }
        
        const identifier = header.querySelector('identifier')?.textContent;
        const datestamp = header.querySelector('datestamp')?.textContent;
        
        // Get setSpec elements (can be multiple)
        const sets: string[] = [];
        const setSpecs = header.querySelectorAll('setSpec');
        for (const setSpec of setSpecs) {
          if (setSpec.textContent) {
            sets.push(setSpec.textContent);
          }
        }
        
        if (identifier) {
          identifiers.push({
            identifier,
            datestamp: datestamp || '',
            setSpec: sets
          });
        }
      }
      
      // Check for resumption token for handling resumption
      const resumptionToken = xmlDoc.querySelector('resumptionToken')?.textContent;
      if (resumptionToken) {
        console.log(`More results available with resumptionToken: ${resumptionToken}`);
        
        // To fully implement resumption token handling, you would make additional
        // requests here using the token. For simplicity, we're just noting it for now.
      }
      
      return identifiers;
    } catch (e) {
      console.error('Error in ListIdentifiers:', e);
      return [];
    }
  }
  
  /**
   * Get a specific record by identifier
   */
  async getRecord(identifier: string, metadataPrefix: string = ''): Promise<BiblioRecord | null> {
    try {
      metadataPrefix = metadataPrefix || this.defaultMetadataPrefix;
      
      const params = {
        'identifier': identifier,
        'metadataPrefix': metadataPrefix
      };
      
      const url = this.buildUrl('GetRecord', params);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        }
      });
      
      if (!response.ok) {
        console.error(`GetRecord request failed: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for error
      const error = this.checkForErrors(xmlDoc);
      if (error) {
        console.error(`OAI-PMH error in GetRecord: ${error}`);
        return null;
      }
      
      // Extract record
      const recordElement = xmlDoc.querySelector('record');
      if (!recordElement) {
        console.warn(`No record found for identifier ${identifier}`);
        return null;
      }
      
      return this.process_record_element(recordElement, metadataPrefix);
    } catch (e) {
      console.error(`Error in GetRecord for ${identifier}:`, e);
      return null;
    }
  }

  /**
   * List records with optional filtering
   */
  async list_records(
    metadata_prefix: string = '',
    set_spec: string = '',
    from_date: string = '',
    until_date: string = '',
    max_results: number = 10
  ): Promise<[number, BiblioRecord[]]> {
    try {
      metadata_prefix = metadata_prefix || this.defaultMetadataPrefix;
      
      // Build parameters
      const params: Record<string, string> = {
        'metadataPrefix': metadata_prefix
      };
      
      if (set_spec) {
        params['set'] = set_spec;
      }
      if (from_date) {
        params['from'] = from_date;
      }
      if (until_date) {
        params['until'] = until_date;
      }
      
      const url = this.buildUrl('ListRecords', params);
      console.log(`Executing ListRecords: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        }
      });
      
      if (!response.ok) {
        throw new Error(`OAI request failed: ${response.status} ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const xmlDoc = this.parser.parseFromString(xmlText, 'application/xml');
      
      // Check for error
      const error = this.checkForErrors(xmlDoc);
      if (error) {
        console.error(`OAI-PMH error: ${error}`);
        if (error.includes('noRecordsMatch')) {
          return [0, []];
        }
        return [0, []];
      }
      
      // Extract total count if available
      let totalCount = 0;
      const resumptionToken = xmlDoc.querySelector('resumptionToken');
      if (resumptionToken && resumptionToken.getAttribute('completeListSize')) {
        totalCount = parseInt(resumptionToken.getAttribute('completeListSize') || '0', 10);
      }
      
      // Extract records
      const records: BiblioRecord[] = [];
      const recordElements = xmlDoc.querySelectorAll('record');
      
      for (let i = 0; i < recordElements.length && records.length < max_results; i++) {
        const recordElement = recordElements[i];
        
        // Skip deleted records
        const header = recordElement.querySelector('header');
        if (header?.getAttribute('status') === 'deleted') {
          continue;
        }
        
        const record = this.process_record_element(recordElement, metadata_prefix);
        
        if (record) {
          records.push(record);
        }
      }
      
      // If no total count was found, use the number of records
      if (totalCount === 0) {
        totalCount = records.length;
      }
      
      return [totalCount, records];
    } catch (e) {
      console.error('Error in list_records:', e);
      return [0, []];
    }
  }
  
  /**
   * Process a record XML element into a BiblioRecord
   */
  private process_record_element(recordElement: Element, metadataPrefix: string): BiblioRecord {
    try {
      // Extract header information
      const header = recordElement.querySelector('header');
      const identifierElement = header?.querySelector('identifier');
      const datestampElement = header?.querySelector('datestamp');
      
      const identifier = identifierElement?.textContent || 'unknown';
      
      // Check if record is deleted
      if (header?.getAttribute('status') === 'deleted') {
        return {
          id: identifier,
          title: `Deleted record: ${identifier}`,
          authors: [],
          editors: [],
          translators: [],
          contributors: [],
          urls: [],
          subjects: []
        };
      }
      
      // Extract metadata
      const metadataElement = recordElement.querySelector('metadata');
      if (!metadataElement) {
        return {
          id: identifier,
          title: `Record without metadata: ${identifier}`,
          authors: [],
          editors: [],
          translators: [],
          contributors: [],
          urls: [],
          subjects: []
        };
      }
      
      // Parse based on metadata prefix
      if (metadataPrefix === 'oai_dc' || metadataPrefix === 'dc') {
        return this.parse_dublin_core(metadataElement, identifier);
      } else {
        // Generic parsing for unknown formats
        return this.parse_generic(metadataElement, identifier);
      }
    } catch (e) {
      console.error('Error processing record element:', e);
      return {
        id: 'error',
        title: `Error processing record: ${e}`,
        authors: [],
        editors: [],
        translators: [],
        contributors: [],
        urls: [],
        subjects: []
      };
    }
  }
  
  /**
   * Parse Dublin Core metadata
   */
  private parse_dublin_core(metadataElement: Element, identifier: string): BiblioRecord {
    // Find the DC metadata
    const dcElement = metadataElement.querySelector('dc') || 
                      metadataElement.querySelector('oai_dc\\:dc') ||
                      metadataElement.querySelector('*|dc');
    
    if (!dcElement) {
      return {
        id: identifier,
        title: `Record without DC metadata: ${identifier}`,
        authors: [],
        editors: [],
        translators: [],
        contributors: [],
        urls: [],
        subjects: []
      };
    }
    
    // Initialize the record
    const record: BiblioRecord = {
      id: identifier,
      title: "Untitled",
      authors: [],
      editors: [],
      translators: [],
      contributors: [],
      urls: [],
      subjects: []
    };
    
    // Extract title
    const titleElement = dcElement.querySelector('title') || 
                         dcElement.querySelector('dc\\:title') ||
                         dcElement.querySelector('*|title');
    if (titleElement?.textContent) {
      record.title = titleElement.textContent.trim();
      
      // Clean up title - remove author info at the end
      record.title = record.title.replace(/\s*\/\s*[^\/]+$/, '');
    }
    
    // Track seen names to avoid duplicates
    const seenNames = new Set<string>();
    
    // Extract creators (authors)
    const creatorElements = dcElement.querySelectorAll('creator, dc\\:creator, *|creator');
    for (const creatorElem of creatorElements) {
      if (creatorElem.textContent) {
        const name = creatorElem.textContent.trim();
        
        // Check for editor roles
        if (/\[\s*(?:Herausgeber|Hrsg\.?|Editor|Ed\.?)\s*\]/.test(name)) {
          const cleanName = name.replace(/\s*\[\s*(?:Herausgeber|Hrsg\.?|Editor|Ed\.?)\s*\]/, '').trim();
          if (cleanName && !seenNames.has(cleanName)) {
            record.editors.push(cleanName);
            seenNames.add(cleanName);
          }
        }
        // Check for translator roles
        else if (/\[\s*Übersetzer\s*\]/.test(name)) {
          const cleanName = name.replace(/\s*\[\s*Übersetzer\s*\]/, '').trim();
          if (cleanName && !seenNames.has(cleanName)) {
            record.translators.push(cleanName);
            seenNames.add(cleanName);
          }
        }
        // Regular author
        else {
          // Clean up author text - remove role indicators in brackets
          const cleanName = name.replace(/\s*\[[^\]]*\]/, '').trim();
          if (cleanName && !seenNames.has(cleanName)) {
            record.authors.push(cleanName);
            seenNames.add(cleanName);
          }
        }
      }
    }
    
    // Extract contributors
    const contributorElements = dcElement.querySelectorAll('contributor, dc\\:contributor, *|contributor');
    for (const contribElem of contributorElements) {
      if (contribElem.textContent) {
        const name = contribElem.textContent.trim();
        
        // Check for editor roles
        if (/\b(editor|ed\.|hrsg|hg\.)\b/i.test(name) || name.toLowerCase().includes('(ed')) {
          const cleanName = name
            .replace(/\s*[\(\[][^)]*(?:ed|hrsg|edit|hg)[^)]*[\)\]]/, '')
            .replace(/\s*(?:ed|hrsg|edit|hg)\.?(?:\s+|$)/, '')
            .trim();
          
          if (cleanName && !seenNames.has(cleanName)) {
            record.editors.push(cleanName);
            seenNames.add(cleanName);
          }
        }
        // Check for translator roles
        else if (/\b(translator|trans\.|übers)\b/i.test(name) || name.toLowerCase().includes('(trans')) {
          const cleanName = name
            .replace(/\s*[\(\[][^)]*(?:trans|übers)[^)]*[\)\]]/, '')
            .replace(/\s*(?:trans|transl|translator|übers)\.?(?:\s+|$)/, '')
            .trim();
          
          if (cleanName && !seenNames.has(cleanName)) {
            record.translators.push(cleanName);
            seenNames.add(cleanName);
          }
        }
        // Regular contributor
        else if (!seenNames.has(name)) {
          record.contributors.push({ name, role: 'contributor' });
          seenNames.add(name);
        }
      }
    }
    
    // Extract date/year
    const dateElements = dcElement.querySelectorAll('date, dc\\:date, *|date');
    for (const dateElem of dateElements) {
      if (dateElem.textContent) {
        const dateText = dateElem.textContent.trim();
        const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
        if (yearMatch) {
          record.year = yearMatch[1];
          break;
        }
      }
    }
    
    // Extract publisher
    const publisherElement = dcElement.querySelector('publisher, dc\\:publisher, *|publisher');
    if (publisherElement?.textContent) {
      const publisherText = publisherElement.textContent.trim();
      
      // Split place and publisher if separated by " : "
      if (publisherText.includes(' : ')) {
        const parts = publisherText.split(' : ', 2);
        record.place_of_publication = parts[0].trim();
        record.publisher_name = parts[1].trim();
      } else {
        record.publisher_name = publisherText;
      }
    }
    
    // Extract format
    const formatElement = dcElement.querySelector('format, dc\\:format, *|format');
    if (formatElement?.textContent) {
      record.format = formatElement.textContent.trim();
    }
    
    // Extract language
    const languageElement = dcElement.querySelector('language, dc\\:language, *|language');
    if (languageElement?.textContent) {
      record.language = languageElement.textContent.trim();
    }
    
    // Extract subjects
    const subjectElements = dcElement.querySelectorAll('subject, dc\\:subject, *|subject');
    for (const subjectElem of subjectElements) {
      if (subjectElem.textContent?.trim()) {
        record.subjects.push(subjectElem.textContent.trim());
      }
    }
    
    // Extract identifiers (ISBN, ISSN, URL)
    const identifierElements = dcElement.querySelectorAll('identifier, dc\\:identifier, *|identifier');
    for (const idElem of identifierElements) {
      if (idElem.textContent) {
        const idText = idElem.textContent.trim().toLowerCase();
        
        // Extract URL
        if (idText.startsWith('http')) {
          record.urls.push(idText);
        }
        // Extract ISBN
        else if (idText.includes('isbn')) {
          const isbnMatch = /(?:isbn[:\s]*)?(\d[\d\-X]+)/i.exec(idText);
          if (isbnMatch) {
            record.isbn = isbnMatch[1];
          }
        }
        // Extract ISSN
        else if (idText.includes('issn')) {
          const issnMatch = /(?:issn[:\s]*)?(\d{4}-\d{3}[\dX])/i.exec(idText);
          if (issnMatch) {
            record.issn = issnMatch[1];
          }
        }
      }
    }
    
    // Extract description/abstract
    const descriptionElement = dcElement.querySelector('description, dc\\:description, *|description');
    if (descriptionElement?.textContent) {
      record.abstract = descriptionElement.textContent.trim();
    }
    
    // Extract source info that might contain journal title or series
    const sourceElement = dcElement.querySelector('source, dc\\:source, *|source');
    if (sourceElement?.textContent) {
      const sourceText = sourceElement.textContent.trim();
      
      // Check for journal pattern with volume/issue
      const journalMatch = /([^,]+),\s*(?:Vol(?:ume)?\.?\s*(\d+))?,?\s*(?:No\.?\s*(\d+))?,?\s*(?:pp\.?\s*(\d+(?:-\d+)?))?/.exec(sourceText);
      if (journalMatch) {
        record.journal_title = journalMatch[1]?.trim();
        record.volume = journalMatch[2];
        record.issue = journalMatch[3];
        record.pages = journalMatch[4];
      }
      // Check for book chapter pattern
      else if (/in:/.test(sourceText.toLowerCase()) || /in /.test(sourceText.toLowerCase())) {
        const bookMatch = /(?:in:?|In:?)\s*([^,]+)/.exec(sourceText);
        if (bookMatch) {
          record.series = bookMatch[1]?.trim();
        }
      }
    }
    
    // Determine document type
    if (record.journal_title && (record.volume || record.issue)) {
      record.document_type = "Journal Article";
    } else if (record.series) {
      record.document_type = "Book Chapter";
    } else if (record.format?.toLowerCase().includes('book')) {
      record.document_type = "Book";
    }
    
    // Store the raw XML if needed for debugging
    try {
      record.raw_data = new XMLSerializer().serializeToString(metadataElement);
    } catch (e) {
      console.error('Error serializing raw XML:', e);
    }
    
    return record;
  }
  
  /**
   * Parse generic metadata (fallback for unknown formats)
   */
  private parse_generic(metadataElement: Element, identifier: string): BiblioRecord {
    // Initialize record
    const record: BiblioRecord = {
      id: identifier,
      title: `Record ${identifier}`,
      authors: [],
      editors: [],
      translators: [],
      contributors: [],
      urls: [],
      subjects: []
    };
    
    // Look for title elements with various possible names
    const titleElements = metadataElement.querySelectorAll('title, *|title');
    if (titleElements.length > 0 && titleElements[0].textContent) {
      record.title = titleElements[0].textContent.trim();
    }
    
    // Look for author/creator elements
    const authorElements = metadataElement.querySelectorAll('creator, author, *|creator, *|author');
    for (const authorElem of authorElements) {
      if (authorElem.textContent?.trim()) {
        record.authors.push(authorElem.textContent.trim());
      }
    }
    
    // Look for date/year elements
    const dateElements = metadataElement.querySelectorAll('date, year, *|date, *|year, dateIssued');
    if (dateElements.length > 0 && dateElements[0].textContent) {
      const dateText = dateElements[0].textContent.trim();
      // Extract year
      const yearMatch = /\b(1\d{3}|20\d{2})\b/.exec(dateText);
      if (yearMatch) {
        record.year = yearMatch[1];
      }
    }
    
    // Look for publisher elements
    const publisherElements = metadataElement.querySelectorAll('publisher, *|publisher');
    if (publisherElements.length > 0 && publisherElements[0].textContent) {
      record.publisher_name = publisherElements[0].textContent.trim();
    }
    
    // Look for subject elements
    const subjectElements = metadataElement.querySelectorAll('subject, *|subject, topic, *|topic');
    for (const subjectElem of subjectElements) {
      if (subjectElem.textContent?.trim()) {
        record.subjects.push(subjectElem.textContent.trim());
      }
    }
    
    // Look for identifier elements - check for ISBN/ISSN/URLs
    const identifierElements = metadataElement.querySelectorAll('identifier, *|identifier');
    for (const idElem of identifierElements) {
      if (idElem.textContent?.trim()) {
        const idText = idElem.textContent.trim();
        
        // Check if it's a URL
        if (idText.startsWith('http')) {
          record.urls.push(idText);
        }
        // Check type attribute if exists
        const idType = idElem.getAttribute('type')?.toLowerCase();
        if (idType === 'isbn') {
          record.isbn = idText;
        } else if (idType === 'issn') {
          record.issn = idText;
        }
      }
    }
    
    // Look for URL elements
    const urlElements = metadataElement.querySelectorAll('url, *|url');
    for (const urlElem of urlElements) {
      if (urlElem.textContent?.trim() && urlElem.textContent.trim().startsWith('http')) {
        record.urls.push(urlElem.textContent.trim());
      }
    }
    
    // Store raw XML data for debugging
    try {
      record.raw_data = new XMLSerializer().serializeToString(metadataElement);
    } catch (e) {
      console.error('Error serializing raw XML:', e);
    }
    
    return record;
  }
  
  /**
   * Make the record_matches_query method public so it can be used by SearchService
   * This change allows the SearchService to use the filter logic in various contexts
   */
  public record_matches_query(record: BiblioRecord, query: Record<string, string>): boolean {
    // Check each search term
    for (const [field, term] of Object.entries(query)) {
      if (!term) continue; // Skip empty terms
      
      const termLower = term.toLowerCase();
      const termWords = termLower.split(/\s+/);
      
      // Title search
      if (field.toLowerCase() === 'title' && record.title) {
        const titleLower = record.title.toLowerCase();
        
        // Try both exact match and word-by-word match
        if (termLower && !titleLower.includes(termLower)) {
          // Check if all words in the term appear in the title
          const wordMatch = termWords.every(word => titleLower.includes(word));
          if (!wordMatch) {
            return false;
          }
        }
      }
      
      // Author search
      else if (field.toLowerCase() === 'author') {
        // Check authors
        let authorMatch = false;
        if (record.authors && record.authors.length > 0) {
          for (const author of record.authors) {
            const authorLower = author.toLowerCase();
            
            // Check for exact substring match
            if (termLower && authorLower.includes(termLower)) {
              authorMatch = true;
              break;
            }
            
            // Try word-by-word match
            if (termWords.every(word => authorLower.includes(word))) {
              authorMatch = true;
              break;
            }
          }
        }
        
        // Check editors if no author match
        if (!authorMatch && record.editors && record.editors.length > 0) {
          for (const editor of record.editors) {
            const editorLower = editor.toLowerCase();
            
            if (termLower && editorLower.includes(termLower)) {
              authorMatch = true;
              break;
            }
            
            if (termWords.every(word => editorLower.includes(word))) {
              authorMatch = true;
              break;
            }
          }
        }
        
        // Check translators if still no match
        if (!authorMatch && record.translators && record.translators.length > 0) {
          for (const translator of record.translators) {
            const translatorLower = translator.toLowerCase();
            
            if (termLower && translatorLower.includes(termLower)) {
              authorMatch = true;
              break;
            }
            
            if (termWords.every(word => translatorLower.includes(word))) {
              authorMatch = true;
              break;
            }
          }
        }
        
        if (!authorMatch) {
          return false;
        }
      }
      
      // ISBN/ISSN search
      else if (field.toLowerCase() === 'isbn' && record.isbn) {
        // Clean ISBN for comparison (remove hyphens and spaces)
        const recordISBN = record.isbn.replace(/[^0-9X]/g, '');
        const searchISBN = term.replace(/[^0-9X]/g, '');
        
        if (!recordISBN.includes(searchISBN)) {
          return false;
        }
      }
      else if (field.toLowerCase() === 'issn' && record.issn) {
        // Clean ISSN for comparison
        const recordISSN = record.issn.replace(/[^0-9X]/g, '');
        const searchISSN = term.replace(/[^0-9X]/g, '');
        
        if (!recordISSN.includes(searchISSN)) {
          return false;
        }
      }
      
      // Year search
      else if (field.toLowerCase() === 'year' && record.year) {
        if (record.year !== term) {
          return false;
        }
      }
      
      // If field is unknown and no match found in known fields, check raw data
      else if (field.toLowerCase() !== 'title' && 
              field.toLowerCase() !== 'author' && 
              field.toLowerCase() !== 'isbn' && 
              field.toLowerCase() !== 'issn' && 
              field.toLowerCase() !== 'year') {
        
        // Try to find in raw data as last resort
        if (record.raw_data && record.raw_data.toLowerCase().includes(termLower)) {
          // Found in raw data, consider it a match
          continue;
        }
        
        // No match found for this field
        return false;
      }
    }
    
    // If we got this far, all search terms matched
    return true;
  }
  
  /**
   * Check for errors in OAI-PMH response
   */
  private checkForErrors(doc: Document): string | null {
    // Check for OAI-PMH error elements
    const errorElement = doc.querySelector('error');
    if (errorElement) {
      const code = errorElement.getAttribute('code') || 'unknown';
      const message = errorElement.textContent || 'Unknown error';
      return `${code}: ${message}`;
    }
    return null;
  }
}