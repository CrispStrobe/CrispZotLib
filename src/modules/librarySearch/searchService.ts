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
  static async executeSearch(params: {
    protocol: string;
    endpoint: string;
    title?: string;
    author?: string;
    isbn?: string;
    maxRecords?: number;
  }): Promise<[boolean, BiblioRecord[]]> {
    const debugMode = getPref("debugMode") || false;
    const debugLogs: string[] = [];

    // Helper function for logging
    const log = (message: string) => {
      ztoolkit.log(message);
      if (debugMode) {
        debugLogs.push(message);
      }
    };

    try {
      log(`========== SEARCH PARAMETERS ==========`);
      log(`Protocol: ${params.protocol}`);
      log(`Endpoint: ${params.endpoint}`);
      log(`Title: ${params.title || 'None'}`);
      log(`Author: ${params.author || 'None'}`);
      log(`ISBN: ${params.isbn || 'None'}`);
      log(`Max Results: ${params.maxRecords || 10}`);
      log(`========================================`);

      // Check that we have at least one search term
      if (!params.title && !params.author && !params.isbn) {
        throw new Error("At least one search term (title, author, or ISBN/ISSN) must be provided");
      }

      // Execute the appropriate search based on protocol
      switch (params.protocol.toLowerCase()) {
        case 'sru':
          return await this.executeSruSearch(params, log);

        case 'oai':
          return await this.executeOaiSearch(params, log);

        case 'ixtheo':
          return await this.executeIxTheoSearch(params, log);

        default:
          throw new Error(`Unsupported protocol: ${params.protocol}`);
      }
    } catch (error) {
      log(`Search error: ${error}`);

      // Show debug dialog if debug mode is enabled
      if (debugMode) {
        this.showDebugDialog(
          "Search Error",
          `Error during search: ${error}`,
          debugLogs.join('\n')
        );
      }

      throw error;
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
      maxRecords?: number;
    },
    log: (message: string) => void
  ): Promise<[boolean, BiblioRecord[]]> {
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

    // Execute search
    const [totalRecords, records] = await client.search(
      query,
      endpointInfo.defaultSchema,
      params.maxRecords || 10
    );

    log(`Found ${totalRecords} total records, fetched ${records.length}`);

    if (records.length === 0) {
      return [false, []];
    }

    return [true, records];
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
  ): Promise<[boolean, BiblioRecord[]]> {
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
    if (params.isbn) searchQuery.isbn = params.isbn;

    log(`OAI-PMH search criteria: ${JSON.stringify(searchQuery)}`);

    // Execute search
    const [totalRecords, records] = await client.search(
      searchQuery,
      endpointInfo.defaultMetadataPrefix,
      undefined, // set
      undefined, // fromDate
      undefined, // untilDate
      params.maxRecords || 10
    );

    log(`Found ${totalRecords} total records, fetched ${records.length}`);

    if (records.length === 0) {
      return [false, []];
    }

    return [true, records];
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
    },
    log: (message: string) => void
  ): Promise<[boolean, BiblioRecord[]]> {
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

      // Parse the response based on format
      const responseText = await response.text();

      // For HTML format, we need to parse the HTML
      if (formatId === 'html') {
        return this.parseIxTheoHtml(responseText, log);
      }

      // For RIS format, parse the RIS data
      if (formatId === 'ris') {
        return this.parseIxTheoRis(responseText, log);
      }

      // For MARC format, just return the raw data for now
      if (formatId === 'marc') {
        const records: BiblioRecord[] = [{
          id: '1',
          title: 'MARC data (not yet parsed)',
          authors: [],
          editors: [],
          translators: [],
          contributors: [],
          urls: [],
          subjects: [],
          raw_data: responseText
        }];

        return [true, records];
      }

      return [false, []];
    } catch (error) {
      log(`Error fetching from IxTheo: ${error}`);
      throw error;
    }
  }

  /**
   * Parse IxTheo HTML results into BiblioRecord objects
   */
  private static parseIxTheoHtml(html: string, log: (message: string) => void): [boolean, BiblioRecord[]] {
    log('Parsing IxTheo HTML results');

    const records: BiblioRecord[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Find result items
    const resultItems = doc.querySelectorAll('.result');

    log(`Found ${resultItems.length} result items in HTML`);

    for (let i = 0; i < resultItems.length; i++) {
      const item = resultItems[i];

      // Extract record data
      const titleElement = item.querySelector('.title');
      const title = titleElement?.textContent?.trim() || 'Untitled';

      // Extract authors
      const authors: string[] = [];
      const authorElements = item.querySelectorAll('.author a');
      authorElements.forEach((el: Element) => {
        if (el.textContent) {
          authors.push(el.textContent.trim());
        }
      });

      // Extract other metadata
      const metadataElements = item.querySelectorAll('.resultItemLine2 .resultItemLine2Info');
      let year = '';
      let publisher = '';

      metadataElements.forEach((el: Element) => {
        const text = el.textContent?.trim() || '';

        // Check for year (typically 4 digits)
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          year = yearMatch[0];
        }

        // Publisher typically comes after year
        if (year && text.includes(year)) {
          const parts = text.split(year);
          if (parts.length > 1) {
            publisher = parts[1].trim().replace(/^[:\s]+/, '');
          }
        }
      });

      // Create record
      const record: BiblioRecord = {
        id: `ixtheo-${i + 1}`,
        title,
        authors,
        editors: [],
        translators: [],
        contributors: [],
        urls: [],
        subjects: [],
        year,
        publisher_name: publisher,
        schema: 'ixtheo-html'
      };

      // Extract URLs
      const linkElements = item.querySelectorAll('a[href]');
      linkElements.forEach((el: Element) => {
        const href = el.getAttribute('href');
        if (href && href.startsWith('http') && !record.urls.includes(href)) {
          record.urls.push(href);
        }
      });

      records.push(record);
    }

    return [records.length > 0, records];
  }

  /**
   * Parse IxTheo RIS formatted results into BiblioRecord objects
   */
  private static parseIxTheoRis(risText: string, log: (message: string) => void): [boolean, BiblioRecord[]] {
    log('Parsing IxTheo RIS results');

    const records: BiblioRecord[] = [];

    // Split RIS by record separator (ER  -)
    const risRecords = risText.split('ER  -').filter(r => r.trim().length > 0);

    log(`Found ${risRecords.length} records in RIS data`);

    for (let i = 0; i < risRecords.length; i++) {
      const risRecord = risRecords[i];
      const lines = risRecord.split('\n').map(line => line.trim()).filter(line => line.length > 0);

      // Initialize record with defaults
      const record: BiblioRecord = {
        id: `ris-${i + 1}`,
        title: 'Untitled',
        authors: [],
        editors: [],
        translators: [],
        contributors: [],
        urls: [],
        subjects: [],
        schema: 'ixtheo-ris',
        raw_data: risRecord
      };

      // Parse RIS tags
      for (const line of lines) {
        // RIS format: TAG  - Value
        const match = line.match(/^([A-Z][A-Z0-9])  - (.*)$/);

        if (!match) continue;

        const [_, tag, value] = match;

        switch (tag) {
          case 'TI': // Title
            record.title = value;
            break;

          case 'AU': // Author
            record.authors.push(value);
            break;

          case 'ED': // Editor
            record.editors.push(value);
            break;

          case 'Y1': // Year
          case 'PY':
            const yearMatch = value.match(/(\d{4})/);
            if (yearMatch) {
              record.year = yearMatch[1];
            }
            break;

          case 'PB': // Publisher
            record.publisher_name = value;
            break;

          case 'CY': // City/Place of publication
            record.place_of_publication = value;
            break;

          case 'SN': // ISBN/ISSN
            if (value.includes('-')) {
              if (value.length >= 17) { // ISBN-13 with hyphens is typically 17 chars
                record.isbn = value;
              } else {
                record.issn = value;
              }
            } else {
              if (value.length >= 13) { // ISBN-13 without hyphens
                record.isbn = value;
              } else if (value.length >= 8) { // ISSN without hyphens
                record.issn = value;
              }
            }
            break;

          case 'JO': // Journal
          case 'T2': // Secondary title (journal for articles)
            record.journal_title = value;
            break;

          case 'VL': // Volume
            record.volume = value;
            break;

          case 'IS': // Issue
            record.issue = value;
            break;

          case 'SP': // Start page
          case 'EP': // End page
            if (!record.pages) {
              record.pages = value;
            } else if (!record.pages.includes(value)) {
              // If we have start page and this is end page, combine them
              record.pages = `${record.pages}-${value}`;
            }
            break;

          case 'UR': // URL
            record.urls.push(value);
            break;

          case 'AB': // Abstract
            record.abstract = value;
            break;

          case 'KW': // Keywords
            record.subjects.push(value);
            break;

          case 'LA': // Language
            record.language = value;
            break;

          case 'TY': // Type
            // Map RIS type to document_type
            switch (value) {
              case 'JOUR':
                record.document_type = 'Journal Article';
                break;
              case 'BOOK':
                record.document_type = 'Book';
                break;
              case 'CHAP':
                record.document_type = 'Book Chapter';
                break;
              case 'THES':
                record.document_type = 'Thesis';
                break;
              default:
                record.document_type = value;
            }
            break;
        }
      }

      records.push(record);
    }

    return [records.length > 0, records];
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