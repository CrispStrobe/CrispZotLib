// src/modules/librarySearch/searchService.ts

import { BiblioRecord } from './models';
import { SRUClient } from './sruClient';
import { OAIClient } from './oaiClient';
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from './endpoints';
import { getPref } from '../../utils/prefs';

/**
 * SearchService - Implements a pure TypeScript search system
 * that replaces the previous Python-based approach
 */
export class SearchService {
  // SRU client cache
  private static sruClients: Record<string, SRUClient> = {};

  // OAI client cache
  private static oaiClients: Record<string, OAIClient> = {};

  /**
   * Execute a search with the specified parameters
   */
  static async executeSearch(
    params: {
      protocol: string;
      endpoint: string;
      title?: string;
      author?: string;
      isbn?: string;
      schema?: string; // For SRU
      maxRecords?: number;
      startRecord?: number; // For SRU pagination
      // Add resumptionToken if implementing OAI pagination later
    },
    log: (message: string) => void = ztoolkit.log // Default logger
  ): Promise<[boolean, BiblioRecord[], number]> { // Return total records count
    log(`Executing search with params: ${JSON.stringify(params)}`);
    try {
      switch (params.protocol.toLowerCase()) {
        case 'sru':
          return await this.executeSruSearch(params, log);
        case 'oai':
          // Note: OAI uses resumptionToken, not startRecord.
          // Current client doesn't support it, so we ignore startRecord for now.
          return await this.executeOaiSearch(params, log);
        case 'ixtheo':
          // IxTheo URL doesn't seem to support startRecord either.
          return await this.executeIxTheoSearch(params, log);
        default:
          throw new Error(`Unsupported protocol: ${params.protocol}`);
      }
    } catch (error: any) {
      log(`Search execution failed: ${error.message}`);
      return [false, [], 0]; // Return failure state with 0 total
    }
  }

  /**
   * Execute an SRU protocol search
   */
  private static async executeSruSearch(
    params: {
      endpoint: string;
      title?: string;
      author?: string;
      isbn?: string;
      schema?: string;
      maxRecords?: number;
      startRecord?: number; 
    },
    log: (message: string) => void
  ): Promise<[boolean, BiblioRecord[], number]> { // number for totalRecords
   try { 
    const endpointId = params.endpoint;

    // Verify endpoint exists
    if (!(endpointId in SRU_ENDPOINTS)) {
      throw new Error(`Unknown SRU endpoint: ${endpointId}`);
    }

    const endpointInfo = SRU_ENDPOINTS[endpointId];
    log(`Using SRU endpoint: ${endpointInfo.name}`);

    // Get or create an SRU client for this endpoint
    let client = this.sruClients[endpointId];
    if (!client) {
      client = new SRUClient(
        endpointInfo.url,
        endpointInfo.defaultSchema,
        endpointInfo.version || '1.1'
      );
      this.sruClients[endpointId] = client;
    }

    // Build search query
    let query = this.buildSruQuery(params, endpointId);
    if (!query) {
      throw new Error("Failed to build SRU query");
    }

    log(`SRU Query: ${query}`);

    // Determine schema to use: user's choice OR endpoint default
    const schemaToUse = params.schema || endpointInfo.defaultSchema;
    log(`Using schema: ${schemaToUse || '(Endpoint Default)'}`);

    // Execute search using the chosen schema
    const [totalRecords, records] = await client.search(
      query,
      schemaToUse, // Pass the determined schema here
      params.maxRecords || 10,
      params.startRecord || 1 // Use startRecord for pagination
    );

    log(`SRU: Found ${totalRecords} total records, fetched ${records.length} starting from ${params.startRecord || 1}`);

    if (records.length === 0) {
      // Return totalRecords even if no records found on this page
      return [false, [], totalRecords];
    }
    // Return totalRecords along with success and records
    return [true, records, totalRecords];

  } catch (error: any) {
    log(`SRU search error for endpoint ${params.endpoint}: ${error.message}`);
    return [false, [], 0]; // Indicate failure
  }

  }

  /**
   * Execute an OAI-PMH protocol search
   */
  private static async executeOaiSearch(
    params: {
      endpoint: string;
      title?: string;
      author?: string;
      isbn?: string;
      maxRecords?: number;
    },
    log: (message: string) => void
  ): Promise<[boolean, BiblioRecord[], number]> {
    const endpointId = params.endpoint;

    // Verify endpoint exists
    if (!(endpointId in OAI_ENDPOINTS)) {
      throw new Error(`Unknown OAI-PMH endpoint: ${endpointId}`);
    }

    const endpointInfo = OAI_ENDPOINTS[endpointId];
    log(`Using OAI-PMH endpoint: ${endpointInfo.name}`);

    // Get or create an OAI client for this endpoint
    let client = this.oaiClients[endpointId];
    if (!client) {
      client = new OAIClient(
        endpointInfo.url,
        endpointInfo.defaultMetadataPrefix || 'oai_dc'
      );
      this.oaiClients[endpointId] = client;
    }

    // Build search criteria
    const searchQuery: Record<string, string> = {};
    if (params.title) searchQuery.title = params.title;
    if (params.author) searchQuery.author = params.author;
    if (params.isbn) searchQuery.isbn = params.isbn; // Assuming client handles ISBN query

    try {

    log(`OAI-PMH search criteria: ${JSON.stringify(searchQuery)}`);

    // TODO: Update OAIClient to handle resumption tokens for true pagination
    // For now, it likely fetches only the first batch.

    // Execute search
    const [totalRecordsEstimate, records] = await client.search(
      searchQuery,
      endpointInfo.defaultMetadataPrefix,
      undefined, // set
      undefined, // fromDate
      undefined, // untilDate
      params.maxRecords || 10
      // Pass resumptionToken here if implemented
    );

    // Note: OAI total might be an estimate or only for the first page without resumption token handling

    log(`Found ${totalRecordsEstimate} total records, fetched ${records.length}`);

    // Return success status, the fetched records, and the total estimate
    return [true, records, totalRecordsEstimate];
  } catch (error: any) {
    log(`OAI search error for endpoint ${params.endpoint}: ${error.message}`);
    return [false, [], 0]; // Indicate failure
  }

  }

  /**
   * Execute an IxTheo search (implemented using direct HTTP fetch)
   */
  private static async executeIxTheoSearch(
    params: {
      endpoint: string; // Format: ris, marc, html
      title?: string;
      author?: string;
      isbn?: string;
      maxRecords?: number;
      // Note: implement pagination later
    },
    log: (message: string) => void
  ): Promise<[boolean, BiblioRecord[], number]> { // Return total count
    const formatId = params.endpoint;

    // Verify format exists
    if (!(formatId in IXTHEO_ENDPOINTS)) {
      throw new Error(`Unknown IxTheo format: ${formatId}`);
    }

    const endpointInfo = IXTHEO_ENDPOINTS[formatId];
    log(`Using IxTheo endpoint: ${endpointInfo.name}`);

    // Build query URL
    const queryParams = new URLSearchParams();
    queryParams.append('lookfor', [
      params.title ? `title:${params.title}` : '',
      params.author ? `author:${params.author}` : '',
      params.isbn ? `isn:${params.isbn}` : ''
    ].filter(Boolean).join(' '));

    queryParams.append('type', 'AllFields');
    queryParams.append('limit', String(params.maxRecords || 10));
    queryParams.append('sort', 'relevance');
    queryParams.append('view', 'list');

    // For export format
    if (formatId === 'ris') {
      queryParams.append('export', 'RISPlusAbstract');
    } else if (formatId === 'marc') {
      queryParams.append('export', 'MARC');
    }

    const url = `${endpointInfo.url}?${queryParams.toString()}`;
    log(`IxTheo query URL: ${url}`);

    try {
      // Execute fetch request
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`IxTheo request failed: ${response.status} ${response.statusText}`);
      }
      const responseText = await response.text();

      let records: BiblioRecord[] = [];
      let totalFound = 0; // Placeholder for total

      if (formatId === 'html') {
        // Placeholder: Implement HTML parsing
        [records, totalFound] = this.parseIxTheoHtml(responseText, log);
        log(`IxTheo HTML: Parsed ${records.length} records. Reported total (if found): ${totalFound}`);
      } else if (formatId === 'ris') {
        // Placeholder: Implement RIS parsing
        [records, totalFound] = this.parseIxTheoRis(responseText, log);
        log(`IxTheo RIS: Parsed ${records.length} records. Total unknown from RIS.`);
      } else if (formatId === 'marc') {
        // Placeholder: Implement MARC parsing or keep raw
        log("IxTheo MARC: Parsing not implemented. Returning raw data structure.");
        records = [{
          id: 'marc-raw-1',
          title: 'MARC data (not parsed)',
          raw_data: responseText,
          // Add other fields as empty defaults
          authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [],
        }];
        totalFound = records.length; // Only know about the one raw record
      }

      // Since IxTheo pagination is unclear/unsupported via this URL,
      // we return the number of *parsed* records as the 'total' for this view.
      // A better implementation might try to scrape the total from HTML if possible.
      return [true, records, totalFound > 0 ? totalFound : records.length];
    } catch (error: any) {
      log(`Error fetching/parsing from IxTheo: ${error.message}`);
      return [false, [], 0]; // Indicate failure
    }
  }

  /**
   * Parse IxTheo HTML results into BiblioRecord objects
   */
  private static parseIxTheoHtml(htmlText: string, log: (message: string) => void): [BiblioRecord[], number] {
    log('Parsing IxTheo HTML results');
    const records: BiblioRecord[] = [];
    let totalCount = 0; // Initialize total count

    try {
      // Access DOMParser from the Zotero environment's window context
      const win = _globalThis.window2 as any; // Or appropriate global context for Zotero plugins
      if (!win || !win.DOMParser) {
          log("DOMParser not available in this context.");
          // Return empty results and 0 count if parser is unavailable
          return [records, 0];
      }
      const parser = new win.DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // --- Attempt to find total count (adjust selector based on actual IxTheo HTML) ---
      // Example: Look for an element showing "X results found"
      const countElement = doc.querySelector(".result_count strong, #result_count strong, .resultcount strong"); // Try common selectors
      if (countElement?.textContent) {
          const match = countElement.textContent.match(/(\d+)/);
          if (match) {
              totalCount = parseInt(match[1], 10);
              log(`Found total count from HTML: ${totalCount}`);
          }
      }
      // --- End Total Count Extraction ---

      // --- Find result items (adjust selector based on actual IxTheo HTML) ---
      const resultItems = doc.querySelectorAll('.result_item, .result'); // Try common selectors for result items
      log(`Found ${resultItems.length} result items in HTML`);

      resultItems.forEach((item: Element, index: number) => {
          try {
              // Extract record data (adjust selectors based on actual IxTheo HTML)
              const titleElement = item.querySelector('.title a, .record-title a'); // Example selectors
              const title = titleElement?.textContent?.trim() || 'Untitled';

              // Extract authors
              const authors: string[] = [];
              // Example: Authors might be in a div with class 'author' or similar
              const authorElements = item.querySelectorAll('.author a, .authors a, .creator a');
              authorElements.forEach((el: Element) => {
                  if (el.textContent) {
                      authors.push(el.textContent.trim());
                  }
              });

              // Extract other metadata (e.g., year, publisher from a line)
              // Example: Look for a line containing publication info
              const metadataElements = item.querySelectorAll('.resultItemLine2 .resultItemLine2Info, .publication_info, .details');
              let year = '';
              let publisher = '';

              metadataElements.forEach((el: Element) => {
                  const text = el.textContent?.trim() || '';
                  if (!year) { // Only find the first year
                      const yearMatch = text.match(/\b(1[89]\d{2}|20\d{2})\b/); // Match years 1800-2099
                      if (yearMatch) {
                          year = yearMatch[0];
                      }
                  }
                  // Example: Publisher might be after year or in a specific element
                  if (!publisher && year && text.includes(year)) {
                      const parts = text.split(year);
                      if (parts.length > 1) {
                          // Take text after the year, remove leading colon/space
                          publisher = parts[1].trim().replace(/^[:\s]+/, '').split(/[,;]/)[0].trim(); // Take first part as publisher
                      }
                  } else if (!publisher) {
                      // Alternative: look for publisher in a specific class
                      const pubElement = item.querySelector('.publisher, .publication .publisher');
                      if (pubElement?.textContent) {
                          publisher = pubElement.textContent.trim();
                      }
                  }
              });

              // Create record
              const record: BiblioRecord = {
                  id: `ixtheo-html-${index + 1}`, // Use 1-based index for ID
                  title,
                  authors,
                  editors: [], // Initialize empty arrays
                  translators: [],
                  contributors: [],
                  urls: [],
                  subjects: [],
                  year: year || undefined, // Use undefined if year is empty
                  publisher_name: publisher || undefined, // Use undefined if publisher is empty
                  schema: 'ixtheo-html',
                  raw_data: item.outerHTML as string // Assert that outerHTML is a string. Store the raw HTML snippet for debugging
              };

              // Extract URLs (look for links within the item)
              const linkElements = item.querySelectorAll('a[href]');
              linkElements.forEach((el: Element) => {
                  const href = el.getAttribute('href');
                  // Basic check for valid-looking URLs, avoid internal anchors/javascript
                  if (href && href.match(/^https?:\/\//) && !record.urls.includes(href)) {
                      record.urls.push(href);
                  }
              });

              records.push(record);
          } catch (itemError: any) {
              log(`Error parsing individual HTML item ${index + 1}: ${itemError.message}`);
          }
      });

      // If totalCount wasn't found, use the number of parsed records
      if (totalCount === 0 && records.length > 0) {
          totalCount = records.length;
          log(`Total count not found in HTML, using parsed count: ${totalCount}`);
      } else if (records.length > totalCount) {
          // Sometimes the parsed count might exceed reported total if scraping is imperfect
          log(`Warning: Parsed records (${records.length}) exceed reported total (${totalCount}). Using parsed count.`);
          totalCount = records.length;
      }

    } catch (error: any) {
        log(`Error parsing IxTheo HTML: ${error.message}`);
        // Return empty results and 0 count on major parsing error
        return [records, 0];
    }

    // Return the parsed records and the determined total count
    return [records, totalCount];
  }

  /**
   * Parse IxTheo RIS formatted results into BiblioRecord objects
   */
  private static parseIxTheoRis(risText: string, log: (message: string) => void): [BiblioRecord[], number] {
    log('Parsing IxTheo RIS results');
    const records: BiblioRecord[] = [];

    try {
      // Split RIS by record separator (ER  -). Handle potential variations in spacing/newlines.
      // Regex looks for ER, followed by 2 spaces, a hyphen, and optional whitespace/newline.
      const risRecordsRaw = risText.split(/ER\s{2}-\s*\n?/);

      log(`Found potential ${risRecordsRaw.length} records in RIS data (before filtering empty).`);

      risRecordsRaw.forEach((risRecordText, index) => {
          const trimmedRecordText = risRecordText.trim();
          if (!trimmedRecordText) {
              // Skip empty entries resulting from split
              return;
          }

          try {
              const lines = trimmedRecordText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

              // Initialize record with defaults, ensuring arrays are initialized
              const record: Partial<BiblioRecord> & { authors: string[], editors: string[], translators: string[], contributors: string[], urls: string[], subjects: string[] } = {
                  id: `ris-${index + 1}`, // Use 1-based index
                  title: 'Untitled',
                  authors: [],
                  editors: [],
                  translators: [],
                  contributors: [],
                  urls: [],
                  subjects: [],
                  schema: 'ixtheo-ris',
                  raw_data: trimmedRecordText // Store the trimmed record text
              };

              // Parse RIS tags
              for (const line of lines) {
                  // RIS format: TAG  - Value. Handle potential variations in spacing.
                  // Regex looks for TAG (2 uppercase letters/digits), 2+ spaces, hyphen, optional space, value.
                  const match = line.match(/^([A-Z][A-Z0-9])\s{2,}-\s?(.*)$/);

                  if (!match) {
                      log(`Skipping invalid RIS line: ${line}`);
                      continue;
                  }

                  // Use 'as [string, string, string]' for type safety if needed, or check length
                  const tag = match[1];
                  const value = match[2].trim(); // Trim the extracted value

                  if (!value) continue; // Skip tags with empty values

                  switch (tag) {
                      case 'TI': record.title = value; break;
                      case 'T1': if (!record.title || record.title === 'Untitled') record.title = value; break; // Alternate title
                      case 'AU': record.authors.push(value); break;
                      case 'A1': if (!record.authors.length) record.authors.push(value); break; // Primary author if AU missing
                      case 'A2': record.authors.push(value); break; // Secondary authors
                      case 'ED': record.editors.push(value); break;
                      // Y1/PY for Year
                      case 'Y1':
                      case 'PY':
                          const yearMatch = value.match(/(\d{4})/);
                          if (yearMatch) record.year = yearMatch[1];
                          break;
                      case 'PB': record.publisher_name = value; break;
                      case 'CY': record.place_of_publication = value; break;
                      // SN for ISBN/ISSN
                      case 'SN':
                          const cleanedSN = value.replace(/[- ]/g, ''); // Remove hyphens and spaces
                          if (/^\d{9}[\dX]$/.test(cleanedSN) || /^\d{13}$/.test(cleanedSN)) { // Basic ISBN-10/13 check
                              record.isbn = value; // Store original format
                          } else if (/^\d{4}\d{3}[\dX]$/.test(cleanedSN)) { // Basic ISSN check (8 digits)
                              record.issn = value; // Store original format
                          } else {
                              log(`Unrecognized SN format: ${value}`);
                              // Store as ISBN if it looks more like it, otherwise ISSN
                              if (cleanedSN.length > 10) record.isbn = value; else record.issn = value;
                          }
                          break;
                      case 'JO': record.journal_title = value; break; // Journal name
                      case 'T2': if (!record.journal_title) record.journal_title = value; break; // Alternate journal title
                      case 'BT': record.journal_title = value; break; // Book Title (often used for journal for articles)
                      case 'VL': record.volume = value; break;
                      case 'IS': record.issue = value; break;
                      // SP/EP for Pages
                      case 'SP': // Start page
                          record.pages = value;
                          break;
                      case 'EP': // End page
                          if (record.pages && !record.pages.includes('-')) {
                              record.pages = `${record.pages}-${value}`;
                          } else if (!record.pages) {
                              record.pages = value; // If only end page is present
                          }
                          break;
                      case 'UR': record.urls.push(value); break;
                      case 'L1': if (!record.urls.length) record.urls.push(value); break; // Primary URL
                      case 'AB': record.abstract = value; break;
                      case 'KW': record.subjects.push(value); break;
                      case 'LA': record.language = value; break;
                      // TY for Type
                      case 'TY':
                          switch (value) {
                              case 'JOUR': record.document_type = 'Journal Article'; break;
                              case 'BOOK': record.document_type = 'Book'; break;
                              case 'CHAP': record.document_type = 'Book Chapter'; break;
                              case 'THES': record.document_type = 'Thesis'; break;
                              case 'CONF': record.document_type = 'Conference Paper'; break;
                              case 'RPRT': record.document_type = 'Report'; break;
                              default: record.document_type = value;
                          }
                          break;
                      // Add other relevant tags if needed (e.g., DO for DOI)
                      case 'DO': record.doi = value; break;
                  }
              }

              // Only add if a title was found
              if (record.title && record.title !== 'Untitled') {
                  records.push(record as BiblioRecord); // Cast to BiblioRecord after filling
              } else {
                  log(`Skipping RIS record index ${index} due to missing title.`);
              }
          } catch (itemError: any) {
              log(`Error parsing individual RIS record index ${index}: ${itemError.message}`);
          }
      });

    } catch (error: any) {
        log(`Error parsing IxTheo RIS: ${error.message}`);
        // Return empty results on major parsing error
        return [records, 0];
    }

    // RIS format doesn't typically include total count, so return length of parsed records
    return [records, records.length];
  }

  /**
   * Build an SRU query string for the specified endpoint
   */
  private static buildSruQuery(
    params: {
      title?: string;
      author?: string;
      isbn?: string;
    },
    endpointId: string
  ): string {
    // Get endpoint examples for formatting
    const endpointInfo = SRU_ENDPOINTS[endpointId];
    const examples = endpointInfo?.examples || {};

    // Check for ISBN search (highest priority)
    if (params.isbn) {
      if (examples.isbn) {
        // Extract format from example
        const example = examples.isbn;
        if (example.includes('=')) {
          const parts = example.split('=');
          const prefix = parts[0].trim();

          // Check if quoted in example
          if (parts[1].trim().startsWith('"')) {
            return `${prefix}="${params.isbn}"`;
          } else {
            return `${prefix}=${params.isbn}`;
          }
        }
      }

      // Fallback format by endpoint
      switch (endpointId) {
        case 'dnb': return `ISBN=${params.isbn}`;
        case 'bnf': return `bib.isbn any "${params.isbn}"`;
        case 'zdb': return `ISS=${params.isbn}`; // Assuming ISBN/ISSN
        default: return `isbn=${params.isbn}`;
      }
    }

    // Format author search
    let authorQuery = '';
    if (params.author) {
      if (examples.author) {
        // Extract format from example
        const example = examples.author;
        if (example.includes('=')) {
          const parts = example.split('=');
          const prefix = parts[0].trim();

          // Check if quoted in example
          if (parts[1].trim().startsWith('"')) {
            authorQuery = `${prefix}="${params.author}"`;
          } else {
            authorQuery = `${prefix}=${params.author}`;
          }
        } else if (example.includes(' any ')) {
          const parts = example.split(' any ');
          authorQuery = `${parts[0]} any "${params.author}"`;
        } else if (example.includes(' all ')) {
          const parts = example.split(' all ');
          authorQuery = `${parts[0]} all "${params.author}"`;
        }
      } else {
        // Fallback format by endpoint
        switch (endpointId) {
          case 'dnb': authorQuery = `PER=${params.author}`;
            break;
          case 'bnf': authorQuery = `bib.author any "${params.author}"`;
            break;
          default: authorQuery = `author="${params.author}"`;
        }
      }
    }

    // Format title search
    let titleQuery = '';
    if (params.title) {
      if (examples.title) {
        // Extract format from example
        const example = examples.title;
        if (example.includes('=')) {
          const parts = example.split('=');
          const prefix = parts[0].trim();

          // Check if quoted in example
          if (parts[1].trim().startsWith('"')) {
            titleQuery = `${prefix}="${params.title}"`;
          } else {
            titleQuery = `${prefix}=${params.title}`;
          }
        } else if (example.includes(' any ')) {
          const parts = example.split(' any ');
          titleQuery = `${parts[0]} any "${params.title}"`;
        } else if (example.includes(' all ')) {
          const parts = example.split(' all ');
          titleQuery = `${parts[0]} all "${params.title}"`;
        }
      } else {
        // Fallback format by endpoint
        switch (endpointId) {
          case 'dnb': titleQuery = `TIT=${params.title}`;
            break;
          case 'bnf': titleQuery = `bib.title any "${params.title}"`;
            break;
          default: titleQuery = `title="${params.title}"`;
        }
      }
    }

    // Combine queries
    const queries = [titleQuery, authorQuery].filter(q => q !== '');

    if (queries.length === 0) {
      return '';
    }

    // Join with appropriate operator
    if (endpointId === 'bnf') {
      return queries.join(' and ');
    } else {
      return queries.join(' AND ');
    }
  }

  /**
   * Show a debug information dialog
   */
  private static showDebugDialog(title: string, message: string, debugInfo: string): void {
    try {
      // Create dialog helper
      const dialogHelper = new ztoolkit.Dialog(12, 1)
        .addCell(0, 0, {
          tag: "h2",
          properties: { innerHTML: title }
        })
        .addCell(1, 0, {
          tag: "p",
          properties: { innerHTML: message }
        })
        .addCell(2, 0, {
          tag: "h3",
          properties: { innerHTML: "Debug Information:" }
        })
        .addCell(3, 0, {
          tag: "textarea",
          namespace: "html",
          attributes: { readonly: "true" },
          properties: {
            value: debugInfo,
            rows: 20,
            cols: 80
          },
          styles: {
            width: "100%",
            fontFamily: "monospace",
            whiteSpace: "pre",
            fontSize: "12px"
          }
        })
        .addButton("Copy to Clipboard", "copy", {
          callback: (e) => {
            // Copy debug info to clipboard
            const win = dialogHelper.window;
            if (win) {
              const textarea = win.document.querySelector("textarea");
              if (textarea) {
                textarea.select();
                win.document.execCommand("copy");
              }
            }
          },
          noClose: true
        })
        .addButton("Close", "close");

      // Open dialog
      dialogHelper.open(title, { width: 800, height: 600 });
    } catch (e) {
      // Fallback if dialog creation fails
      console.error(`${title}: ${message}`);
      console.error(debugInfo);

      // Try to use alert as last resort
      try {
        if (Zotero.getMainWindow) {
          const win = Zotero.getMainWindow();
          if (win) {
            win.alert(`${title}\n\n${message}\n\n(See console for full debug info)`);
          }
        }
      } catch (alertError) {
        // Nothing more we can do
      }
    }
  }
}