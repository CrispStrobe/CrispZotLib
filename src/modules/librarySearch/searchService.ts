// src/modules/librarySearch/searchService.ts

import { BiblioRecord } from './models';
import { SRUClient } from './sruClient';
import { OAIClient } from './oaiClient'; // Ensure this is the updated OAIClient
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from './endpoints';
import { getPref } from '../../utils/prefs';

// Assuming SearchParams is correctly defined in integration.ts
// import { SearchParams } from './integration'; // Adjust path if needed

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
   * Execute a search with the specified parameters.
   * This is the main entry point for different protocols.
   */
  static async executeSearch(
    // Use the SearchParams type from integration.ts (adjust import path if needed)
    params: import('./integration').SearchParams,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void = ztoolkit.log // Default logger
    // --- CHANGE: Return type adjusted for OAI token, but needs careful handling by caller ---
    // Returning the token here might break existing callers expecting only 3 values.
    // Option 1: Return only 3 values (discard token here).
    // Option 2: Return 4 values and update callers (integration.ts).
    // Let's go with Option 1 for minimal disruption to this file's signature,
    // assuming integration.ts will handle OAI pagination separately.
  ): Promise<[boolean, BiblioRecord[], number]> { // Keep original return signature
    log(`Executing search with params: ${JSON.stringify(params)}`);
    try {
      switch (params.protocol.toLowerCase()) {
        case 'sru':
          // --- Get DOM capabilities from main window ---
          const mainWindow = Zotero.getMainWindow();
          if (!mainWindow) {
              throw new Error("Could not get Zotero main window for DOM parsing.");
          }
          // Pass the necessary objects/functions to executeSruSearch
          return await this.executeSruSearch(params, log, mainWindow.DOMParser, mainWindow.Node, mainWindow.XPathResult, mainWindow.XMLSerializer);
          // --- End modification ---

        case 'oai':
          // ... (OAI logic remains the same) ...
          const [oaiSuccess, oaiRecords, oaiTotal, oaiNextToken] = await this.executeOaiSearch(params, log);
          if (oaiNextToken) { log(`OAI search returned next resumption token (discarded by executeSearch): ${oaiNextToken.substring(0, 50)}...`); }
          return [oaiSuccess, oaiRecords, oaiTotal];

        case 'ixtheo':
          // ... (IxTheo logic remains the same) ...
          const page = params.startRecord && params.maxRecords ? Math.floor((params.startRecord - 1) / params.maxRecords) + 1 : 1;
          return await this.executeIxTheoSearch({ ...params, page: page, format: params.endpoint }, log);

        default:
          throw new Error(`Unsupported protocol: ${params.protocol}`);
      }
    } catch (error: any) {
      log(`Search execution failed: ${error.message}`, 'error');
      return [false, [], 0];
    }
  }

  /**
   * Execute an SRU protocol search.
   * (No changes needed in this method based on the OAI requirements)
   */
  /**
   * Execute an SRU protocol search.
   * MODIFIED: Accepts DOM capabilities.
   */
  private static async executeSruSearch(
    params: import('./integration').SearchParams,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void,
    // --- Add parameters for DOM capabilities ---
    domParser: typeof DOMParser,
    nodeConst: typeof Node,
    xpathResultConst: typeof XPathResult,
    xmlSerializer: typeof XMLSerializer
    // --- End modification ---
  ): Promise<[boolean, BiblioRecord[], number]> {
    try {
        const endpointId = params.endpoint;
        if (!(endpointId in SRU_ENDPOINTS)) {
          throw new Error(`Unknown SRU endpoint: ${endpointId}`);
        }
        const endpointInfo = SRU_ENDPOINTS[endpointId];
        log(`Using SRU endpoint: ${endpointInfo.name}`);

        let client = this.sruClients[endpointId];
        if (!client) {
          // Remove parser instantiation from constructor if it was there
          client = new SRUClient(endpointInfo.url, endpointInfo.defaultSchema, endpointInfo.version || '1.1');
          this.sruClients[endpointId] = client;
        }

        // --- Build SRU Query (Safer version) ---
        let query = '';
        try {
            query = this.buildSruQuery(params, endpointId); // Call the safer buildSruQuery
            if (!query && !(endpointId === 'dnb' || endpointId === 'zdb')) {
               log("SRU query is empty.", 'warn');
            }
            log(`SRU Query: ${query}`);
        } catch (buildError: any) {
            log(`Error building SRU query: ${buildError.message}`, 'error');
            // Check if the error message matches the one we saw
            if (buildError.message?.includes('suffix is undefined')) {
                 log('Caught potential "suffix is undefined" error during query build.', 'warn');
                 // Decide how to handle: maybe try a default query or re-throw
                 // For now, re-throw to see if the safer buildSruQuery fixed it
                 throw buildError;
            }
            throw buildError; // Re-throw other build errors
        }
        // --- End Build SRU Query ---


        const schemaToUse = params.schema || endpointInfo.defaultSchema;
        log(`Using schema: ${schemaToUse || '(Endpoint Default)'}`);

        // --- Pass DOM capabilities to client.search ---
        const [totalRecords, records] = await client.search(
          query,
          domParser,
          nodeConst,
          xpathResultConst,
          xmlSerializer,
          schemaToUse,
          params.maxRecords || 10,
          params.startRecord || 1,
          // Pass the objects/functions
        );

        log(`SRU: Found ${totalRecords} total records, fetched ${records.length} starting from ${params.startRecord || 1}`);
        return [true, records, totalRecords];

      } catch (error: any) {
        // Log the specific error without assuming 'suffix is undefined'
        log(`SRU search error for endpoint ${params.endpoint}: ${error.message}`, 'error');
        log(`Stack: ${error.stack}`, 'error'); // Add stack trace
        return [false, [], 0];
      }
  }

  /**
   * Execute an OAI-PMH protocol search using the updated OAIClient logic.
   * Handles filtering and calls the appropriate OAIClient methods.
   * (This method already reflects the necessary logic from previous steps)
   */
  private static async executeOaiSearch(
    // Use the SearchParams type which should now include OAI specific fields + resumptionToken
    params: import('./integration').SearchParams,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  // --- CHANGE: Ensure return type matches the implementation ---
  ): Promise<[boolean, BiblioRecord[], number, string | null]> { // Return success, records, total, next token
    const logPrefix = "[SearchService.executeOaiSearch]";
    try {
      const endpointId = params.endpoint;

      if (!(endpointId in OAI_ENDPOINTS)) {
        throw new Error(`Unknown OAI-PMH endpoint: ${endpointId}`);
      }

      const endpointInfo = OAI_ENDPOINTS[endpointId];
      log(`${logPrefix} Using OAI-PMH endpoint: ${endpointInfo.name}`);

      // Get or create OAI client
      let client = this.oaiClients[endpointId];
      if (!client) {
        client = new OAIClient(
          endpointInfo.url,
          endpointInfo.defaultMetadataPrefix // Pass default prefix from endpoint config
        );
        this.oaiClients[endpointId] = client;
      }

      // Prepare filter query for local filtering
      const filterQuery: Record<string, string> = {};
      if (params.title) filterQuery.title = params.title;
      if (params.author) filterQuery.author = params.author;
      // ISBN/ISSN filtering is handled by record_matches_query in the client
      if (params.isbn) filterQuery.isbn = params.isbn;
      // Handle allFieldsTerm for local filtering
      if (params.allFieldsTerm) filterQuery.allFields = params.allFieldsTerm;

      log(`${logPrefix} OAI Harvest Params: set=${params.set}, prefix=${params.metadataPrefix || endpointInfo.defaultMetadataPrefix}, from=${params.from}, until=${params.until}, token=${params.resumptionToken ? '...' : 'none'}`);
      log(`${logPrefix} OAI Local Filter: ${JSON.stringify(filterQuery)}`);

      // Call the updated OAIClient search method
      const [totalCount, records, nextResumptionToken] = await client.search(
        params.metadataPrefix || endpointInfo.defaultMetadataPrefix || 'oai_dc', // Ensure a prefix is always passed
        params.set,          // Pass OAI set parameter
        params.from,         // Pass OAI from date
        params.until,        // Pass OAI until date
        filterQuery,         // Pass local filter terms
        params.maxRecords || 10, // Pass max results limit
        params.resumptionToken // Pass resumption token if available
      );

      log(`${logPrefix} OAIClient returned ${records.length} records (after filtering). Estimated total: ${totalCount}. Next token: ${nextResumptionToken ? '...' : 'null'}`);

      // Return success status (true if >= 0 records found, false only on error),
      // the filtered records for this page, the estimated total count, and the next token.
      // Success is true even if 0 records match the filter, as long as the OAI request itself didn't fail.
      return [true, records, totalCount, nextResumptionToken];

    } catch (error: any) {
      log(`${logPrefix} OAI search error for endpoint ${params.endpoint}: ${error.message}`, 'error');
      // Indicate failure: false success, empty records, 0 total, null token
      return [false, [], 0, null];
    }
  }


  /**
   * Execute an IxTheo search.
   * (No changes needed in this method based on the OAI requirements)
   */
  private static async executeIxTheoSearch(
    params: import('./integration').SearchParams & { page: number, format: string },
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<[boolean, BiblioRecord[], number]> {

    const formatId = params.format; // User's desired *detail* format
    if (!(formatId in IXTHEO_ENDPOINTS)) {
      throw new Error(`Unknown IxTheo format requested: ${formatId}`);
    }
    const endpointInfo = IXTHEO_ENDPOINTS[formatId]; // Get base URL etc.
    log(`Using IxTheo endpoint: ${endpointInfo.name}`);

    // 1. Build URL for the HTML search results page
    const searchUrl = this.buildIxTheoSearchUrl(params, endpointInfo.url); // Use endpointInfo.url which is the search URL
    log(`IxTheo HTML Search URL: ${searchUrl}`);

    try {
      // 2. Fetch HTML results page
      const htmlResponse = await fetch(searchUrl, {
          headers: { // Add browser-like headers
             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
             'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
             'Accept-Language': 'en-US,en;q=0.5',
          }
      });
      if (!htmlResponse.ok) {
        throw new Error(`IxTheo HTML search request failed: ${htmlResponse.status} ${htmlResponse.statusText}`);
      }
      const htmlText = await htmlResponse.text();

      // 3. Parse HTML to get basic info and IDs
      const [parsedResults, totalCount] = this.parseIxTheoHtmlResultsPage(htmlText, log);
      log(`IxTheo HTML Parse: Found ${parsedResults.length} items on page, Total reported: ${totalCount}`);

      if (parsedResults.length === 0) {
        return [true, [], totalCount]; // Success, but no results
      }

      // 4. Fetch detailed data for each result concurrently
      const detailedRecordsPromises = parsedResults.map(async ({ id, basicInfo }) => {
        try {
          log(`Attempting to fetch details for IxTheo record ${id} (format: ${params.format})`, 'log');
          const detailedRecordData = await this.fetchIxTheoRecordDetails(id, params.format, endpointInfo.baseUrl, log);

          if (detailedRecordData) {
              log(`Successfully fetched/parsed details for ${id}.`);
              // Merge basic and detailed info
              const finalRecord: BiblioRecord = {
                  // Defaults
                  title: "Untitled", authors: [], editors: [], translators: [], contributors: [], urls: [], subjects: [],
                  // Overwrite with basic info first
                  ...basicInfo,
                  // Overwrite/add detailed info
                  ...detailedRecordData,
                  // Ensure ID and schema are correct
                  id: id,
                  schema: `ixtheo-${params.format}`,
                  // Prefer detailed raw_data if available
                  raw_data: detailedRecordData.raw_data || basicInfo.raw_data,
              };
              // Ensure arrays exist
              finalRecord.authors = finalRecord.authors || [];
              finalRecord.editors = finalRecord.editors || [];
              finalRecord.translators = finalRecord.translators || [];
              finalRecord.contributors = finalRecord.contributors || [];
              finalRecord.urls = finalRecord.urls || [];
              finalRecord.subjects = finalRecord.subjects || [];
              return finalRecord;
          } else {
            log(`fetchIxTheoRecordDetails returned null for ${id}. Falling back to basic info.`, 'warn');
             // Fallback to basic info if detail fetch fails
             return {
                 id: id, title: basicInfo.title || "Untitled",
                 authors: basicInfo.authors || [], editors: [], translators: [], contributors: [], // Assume these aren't in basic
                 urls: basicInfo.urls || [], subjects: basicInfo.subjects || [],
                 year: basicInfo.year, publisher_name: basicInfo.publisher_name,
                 format: basicInfo.format, raw_data: basicInfo.raw_data,
                 schema: 'ixtheo-html-basic' // Indicate fallback schema
             } as BiblioRecord;
          }
        } catch (detailError: any) {
          log(`Error processing IxTheo record ${id}: ${detailError.message}`, 'error');
           // Return error record
           return {
               id: id, title: basicInfo.title || "[Error Processing Record]",
               authors: basicInfo.authors || [], editors: [], translators: [], contributors: [],
               urls: [], subjects: [],
               year: basicInfo.year, publisher_name: basicInfo.publisher_name,
               format: basicInfo.format, raw_data: `Error: ${detailError.message}\n\n${basicInfo.raw_data || ''}`,
               schema: 'ixtheo-error'
           } as BiblioRecord;
        }
      });

      // Wait for all detail fetches and filter out nulls/errors if needed
      const detailedRecords = (await Promise.all(detailedRecordsPromises))
                                .filter((record): record is BiblioRecord => record !== null && record.schema !== 'ixtheo-error'); // Filter out nulls and error records

      log(`IxTheo: Successfully processed ${detailedRecords.length} records overall.`);
      return [true, detailedRecords, totalCount]; // Success, return processed records and total

    } catch (error: any) {
      log(`Error in executeIxTheoSearch: ${error.message}`, 'error');
      return [false, [], 0]; // Indicate failure
    }
  }

  // --- Helper methods (buildIxTheoSearchUrl, parseIxTheoHtmlResultsPage, fetchIxTheoRecordDetails, etc.) remain the same ---
  // --- Make sure they are correctly implemented as shown previously ---

  /** Helper to build IxTheo Search URL */
  private static buildIxTheoSearchUrl(
    params: import('./integration').SearchParams & { page?: number },
    baseUrl: string // This is the search results URL from IXTHEO_ENDPOINTS
  ): string {
    const queryParams = new URLSearchParams();

    // Prioritize allFieldsTerm
    if (params.allFieldsTerm?.trim()) {
        queryParams.append('lookfor', params.allFieldsTerm.trim());
        queryParams.append('type', 'AllFields');
    }
    // Combine specific fields if allFieldsTerm is not provided
    else {
        const searchTerms: string[] = [];
        if (params.title?.trim()) searchTerms.push(`title:(${params.title.trim()})`);
        if (params.author?.trim()) searchTerms.push(`author:(${params.author.trim()})`);
        if (params.isbn?.trim()) searchTerms.push(`isn:(${params.isbn.trim()})`); // Use isn for IxTheo ISBN/ISSN

        if (searchTerms.length > 0) {
            queryParams.append('lookfor', searchTerms.join(' '));
            queryParams.append('type', 'AllFields'); // Use AllFields even when combining for web search
        } else {
            // Default if no terms provided (fetch recent items)
            queryParams.append('lookfor', '*');
            queryParams.append('type', 'AllFields');
        }
    }

    queryParams.append('limit', String(params.maxRecords || 10));
    queryParams.append('sort', 'relevance'); // Default sort
    if (params.page && params.page > 1) {
        queryParams.append('page', String(params.page));
    }
    // queryParams.append('botprotect', ''); // May or may not be needed

    // Use the provided baseUrl which is the search URL
    return `${baseUrl}?${queryParams.toString()}`;
  }

  /**
   * Parse IxTheo HTML search results page
   * Extracts IDs, basic metadata, and total count.
   */
  private static parseIxTheoHtmlResultsPage(
    htmlText: string,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): [Array<{ id: string; basicInfo: Partial<BiblioRecord> }>, number] {
    log('Parsing IxTheo HTML results page');
    // log(`Raw HTML Text (first 1000 chars): ${htmlText.substring(0, 1000)}`); // Optional: Log raw HTML for deep debugging
    const results: Array<{ id: string; basicInfo: Partial<BiblioRecord> }> = [];
    let totalCount = 0;

    try {
      const win = Zotero.getMainWindow();
      if (!win || !win.DOMParser) {
        log("DOMParser not available via Zotero.getMainWindow()", 'error');
        throw new Error("DOMParser not available.");
      }
      const parser = new win.DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      // log(`Parsed document body outerHTML (first 1000 chars): ${doc.body?.outerHTML?.substring(0, 1000) || 'Body not found'}`); // Optional: Log parsed body

      // --- Extract total results count ---
      // Priority 1: data-record-total attribute
      const statsDiv = doc.querySelector('div.search-stats');
      const dataTotal = statsDiv?.getAttribute('data-record-total');
      if (dataTotal && /^\d+$/.test(dataTotal)) {
          totalCount = parseInt(dataTotal, 10);
          log(`Extracted total count from data-record-total: ${totalCount}`);
      } else {
          // Priority 2: Text content within specific elements
          const summaryElement = doc.querySelector('.search-stats .js-search-stats, .resultHeader .resultcount, .search-stats .pager-text'); // Added more specific selectors
          if (summaryElement?.textContent) {
              const summaryText = summaryElement.textContent;
              // Regex to find numbers after "von", "of", "de", "sur" or just the last number
              const match = summaryText.match(/(?:of|von|de|sur)\s+(\d[\d,.]*)/i) || summaryText.match(/(\d[\d,.]*)\s*$/);
              if (match && match[1]) {
                  totalCount = parseInt(match[1].replace(/[,.]/g, ''), 10);
                  log(`Extracted total count from summary text: ${totalCount}`);
              } else {
                   log(`Could not extract total count number from summary text: "${summaryText}"`, 'warn');
              }
          } else {
               log('Could not find any element containing total count text.', 'warn');
          }
      }

      // --- Extract result items ---
      // *** CORRECTED SELECTOR ***
      const resultItems = doc.querySelectorAll('ol.record-list > li.result');
      log(`Found ${resultItems.length} result items on HTML page using selector 'ol.record-list > li.result'`);

      resultItems.forEach((item: Element, index: number) => {
        // log(`Processing item index ${index}: ${item.outerHTML.substring(0, 200)}...`); // Optional: Log start of each item
        let recordId: string | null = null;
        const basicInfo: Partial<BiblioRecord> = { authors: [], subjects: [], urls: [], editors: [], translators: [], contributors: [] };

        // --- Extract Record ID (Primary: hiddenId) ---
        const hiddenIdInput = item.querySelector('input.hiddenId') as HTMLInputElement;
        if (hiddenIdInput?.value) {
          recordId = hiddenIdInput.value;
        }
        // Fallback: Checkbox value (less reliable)
        if (!recordId) {
          const checkbox = item.querySelector('input.checkbox-select-item') as HTMLInputElement;
          if (checkbox?.value && checkbox.value.includes('|')) {
            recordId = checkbox.value.split('|')[1];
            log(`Used fallback ID from checkbox for item index ${index}`);
          }
        }

        if (!recordId) {
          log(`Could not find record ID for item index ${index}`, 'warn');
          // log(`HTML for item without ID: ${item.outerHTML}`); // Optional: Log full item HTML if ID fails
          return; // Skip item if no ID found
        }
        // log(`Found ID ${recordId} for item index ${index}`); // Optional: Log successful ID

        // --- Extract Basic Metadata ---
        const titleElem = item.querySelector('a.title'); // Selector for title link
        basicInfo.title = titleElem?.textContent?.trim() || 'Untitled';

        // Author: Look for the div immediately following the title's div, then the span inside
        const titleDiv = titleElem?.closest('div'); // Find the div containing the title link
        const authorDiv = titleDiv?.nextElementSibling; // The next div should contain author info
        const authorSpan = authorDiv?.querySelector('span'); // Find the span within that div
        if (authorSpan?.textContent) {
            // Split by semicolon and clean up "(VerfasserIn)" etc.
            basicInfo.authors = authorSpan.textContent.trim().split(';')
                                       .map(a => a.replace(/\([^)]+\)$/, '').trim()) // Remove trailing parenthetical roles
                                       .filter(Boolean); // Remove empty strings
        }

        // Format: Get text from all spans with class 'format'
        const formatElems = item.querySelectorAll('div.result-formats span.format');
        basicInfo.format = (Array.from(formatElems) as Element[])
                            .map(el => el.textContent?.trim())
                            .filter(Boolean)
                            .join(', ') || undefined;

        // Year/Publisher/Subjects are typically NOT in the list view, only on detail page.
        // We'll rely on fetchIxTheoRecordDetails for those.

        // Store raw HTML of the list item for debugging/fallback
        basicInfo.raw_data = item.outerHTML as string;

        results.push({ id: recordId, basicInfo });
      });

      // Estimate total count if not found reliably
      if (totalCount === 0 && results.length > 0) {
        log(`Total count is 0. Using parsed count (${results.length}) as estimate.`, 'warn');
        totalCount = results.length;
      }

    } catch (error: any) {
      log(`Error parsing IxTheo HTML results page: ${error.message}`, 'error');
      log(`Stack trace: ${error.stack}`, 'error'); // Log stack trace
      return [[], 0]; // Return empty on error
    }
    log(`Finished parsing IxTheo HTML. Found ${results.length} items.`);
    return [results, totalCount];
  }

  /**
   * Fetches and parses detailed data for a single IxTheo record.
   */
  private static async fetchIxTheoRecordDetails(
    recordId: string,
    format: string, // 'ris', 'marc', 'html'
    baseUrl: string, // e.g., 'https://ixtheo.de'
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<Partial<BiblioRecord> | null> {
    log(`Fetching details for IxTheo record ${recordId} in format: ${format}`);
    try {
      let resultData: string | null = null;
      let parsedRecord: Partial<BiblioRecord> | null = null;

      if (format === 'ris') {
        resultData = await this.fetchIxTheoExportData(recordId, 'RIS', baseUrl, log);
        if (resultData) parsedRecord = this.parseIxTheoRis(resultData, log);
      } else if (format === 'marc') {
        resultData = await this.fetchIxTheoExportData(recordId, 'MARC', baseUrl, log);
        if (resultData) parsedRecord = this.parseIxTheoMarc(resultData, log);
      } else if (format === 'html') {
        resultData = await this.fetchIxTheoDetailPage(recordId, baseUrl, log);
        if (resultData) parsedRecord = this.parseIxTheoDetailPageHtml(resultData, log);
      } else {
        log(`Unsupported detail format requested: ${format}. Falling back to RIS.`, 'warn');
        resultData = await this.fetchIxTheoExportData(recordId, 'RIS', baseUrl, log);
        if (resultData) parsedRecord = this.parseIxTheoRis(resultData, log);
      }

      if (parsedRecord) {
          log(`Successfully fetched and parsed ${format} for ${recordId}.`);
      } else {
          log(`Failed to get valid ${format} data for ${recordId}.`, 'warn');
      }
      return parsedRecord;

    } catch (error: any) {
      log(`Error in fetchIxTheoRecordDetails for ${recordId} (${format}): ${error.message}`, 'error');
      return null;
    }
  }

  /** Fetches RIS or MARC export data from IxTheo */
  private static async fetchIxTheoExportData(
    recordId: string,
    exportFormat: 'RIS' | 'MARC',
    baseUrl: string,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<string | null> {
    const exportUrl = `${baseUrl}/Record/${recordId}/Export?style=${exportFormat}`;
    log(`Fetching ${exportFormat} export from URL: ${exportUrl}`);
    try {
       const response = await fetch(exportUrl, {
           headers: { // Mimic browser request
               'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
               'Accept': 'text/plain, */*; q=0.01', // Correct accept header for export
               'X-Requested-With': 'XMLHttpRequest', // Often used for AJAX requests
               'Referer': `${baseUrl}/Record/${recordId}`, // Referer header
           }
       });

       log(`Response status for ${exportFormat} export ${recordId}: ${response.status}`);

       if (!response.ok) {
        log(`Export request failed for ${recordId}: ${response.status} ${response.statusText}`, 'error');
        // Check body for specific error messages if possible
        const errorBody = await response.text().catch(() => '');
        if (errorBody.includes("not supported")) {
             log(`Format ${exportFormat} not supported for ${recordId}.`, 'warn');
             return null;
        }
        throw new Error(`Export request failed: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('Content-Type');
      const data = await response.text();
      log(`Response Content-Type for ${exportFormat} export ${recordId}: ${contentType}`);

      // Check for explicit error message in body
      if (data.includes("The selected export format is not supported by this record")) {
          log(`IxTheo reported export format ${exportFormat} not supported for record ${recordId}.`, 'warn');
          return null;
      }
      // Check if content type is unexpected (e.g., HTML instead of plain text/MARC)
      const expectedContentType = exportFormat === 'RIS' ? 'application/x-research-info-systems' : 'application/marc';
      const isPlainText = contentType?.includes('text/plain');
      if (contentType?.includes('text/html') || (!contentType?.includes(expectedContentType) && !(exportFormat === 'RIS' && isPlainText))) {
          log(`Unexpected content type received for ${exportFormat} export ${recordId}: ${contentType}. Assuming failure.`, 'warn');
          return null;
      }

      if (!data.trim()) {
          log(`Export returned empty response for ${recordId} (${exportFormat}).`, 'warn');
          return null;
      }

      log(`${exportFormat} data received and appears valid for ${recordId} (length: ${data.length})`);
      return data;

    } catch (error: any) {
      log(`Error fetching ${exportFormat} export for ${recordId}: ${error.message}`, 'error');
      return null;
    }
  }

  /** Fetches the HTML detail page from IxTheo */
  private static async fetchIxTheoDetailPage(
    recordId: string,
    baseUrl: string,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<string | null> {
    const detailUrl = `${baseUrl}/Record/${recordId}`;
     log(`Fetching HTML detail page from: ${detailUrl}`);
    try {
       const response = await fetch(detailUrl, {
           headers: { // Standard browser headers
               'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
               'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
           }
       });
      if (!response.ok) {
        throw new Error(`Detail page request failed: ${response.status} ${response.statusText}`);
      }
      const html = await response.text();
       log(`HTML detail page received for ${recordId} (length: ${html.length})`);
      return html;
    } catch (error: any) {
      log(`Error fetching detail page for ${recordId}: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * Parse IxTheo RIS formatted results into a partial BiblioRecord
   * (Implementation remains the same as previously provided)
   */
  private static parseIxTheoRis(risText: string, log: (message: string, level?: 'log' | 'warn' | 'error') => void): Partial<BiblioRecord> {
    log(`Starting RIS parsing...`);
    const record: Partial<BiblioRecord> = { authors: [], editors: [], translators: [], urls: [], subjects: [] };
    record.raw_data = risText;
    try {
      const lines = risText.split(/[\r\n]+/);
      let currentTag = '';
      let startPage: string | undefined = undefined;

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const match = trimmedLine.match(/^([A-Z][A-Z0-9])\s{2,}-\s?(.*)$/);
        if (match) {
          currentTag = match[1];
          const currentValue = match[2].trim();
          switch (currentTag) {
            case 'TY': record.format = this.mapRisTypeToFormat(currentValue); break;
            case 'TI': case 'T1': record.title = currentValue; break;
            case 'AU': case 'A1': record.authors?.push(currentValue); break;
            case 'ED': case 'A2': record.editors?.push(currentValue); break;
            case 'A4': record.translators?.push(currentValue); break;
            case 'PY': case 'Y1':
              const yearMatch = currentValue.match(/(\d{4})/);
              if (yearMatch) record.year = yearMatch[1];
              break;
            case 'PB': record.publisher_name = currentValue; break;
            case 'CY': record.place_of_publication = currentValue; break;
            case 'SN':
              const cleanedSN = currentValue.replace(/[- ]/g, '');
              if (/^\d{4}\d{3}[\dX]$/.test(cleanedSN)) { record.issn = currentValue; }
              else { record.isbn = currentValue.replace(/\s*\(.*?\)\s*$/, ''); }
              break;
            case 'T2': case 'JO': case 'JA': case 'JF':
                const format = record.format || (record.issn ? 'Journal Article' : 'Book Chapter');
                if (format === 'Journal Article') { record.journal_title = currentValue; }
                else { record.series = currentValue; }
                break;
            case 'VL': record.volume = currentValue; break;
            case 'IS': record.issue = currentValue; break;
            case 'SP': startPage = currentValue; break;
            case 'EP':
              if (startPage && !startPage.includes('-')) { record.pages = `${startPage}-${currentValue}`; }
              else if (!startPage) { record.pages = currentValue; }
              break;
            case 'UR': case 'L1': record.urls?.push(currentValue); break;
            case 'AB': case 'N2': record.abstract = currentValue; break;
            case 'KW': record.subjects?.push(currentValue); break;
            case 'LA': record.language = currentValue; break;
            case 'DO': record.doi = currentValue; break;
            case 'ET': record.edition = currentValue; break;
          }
        }
      }
      if (startPage && !record.pages) record.pages = startPage;
      record.authors = record.authors || [];
      record.editors = record.editors || [];
      record.translators = record.translators || [];
      record.urls = record.urls || [];
      record.subjects = record.subjects || [];
    } catch (error: any) { log(`Error parsing RIS data: ${error.message}`, 'error'); }
    log(`Finished RIS parsing.`);
    return record;
  }

  /** Helper to map RIS TY field */
  private static mapRisTypeToFormat(risType: string): string | undefined {
      const typeMap: Record<string, string> = {
          'JOUR': 'Journal Article', 'BOOK': 'Book', 'CHAP': 'Book Chapter',
          'THES': 'Thesis', 'CONF': 'Conference Paper', 'RPRT': 'Report',
          'SER': 'Journal', 'MAP': 'Map', 'MUSIC': 'Music Score',
          'GEN': 'Generic', 'ELEC': 'Electronic Resource'
      };
      return typeMap[risType] || risType;
  }

  /**
   * Parse IxTheo MARC formatted results (basic regex implementation)
   * (Implementation remains the same as previously provided)
   */
  private static parseIxTheoMarc(marcText: string, log: (message: string, level?: 'log' | 'warn' | 'error') => void): Partial<BiblioRecord> {
    log(`Starting MARC parsing...`);
    const record: Partial<BiblioRecord> = { authors: [], editors: [], subjects: [], urls: [] };
    record.raw_data = marcText;
    try {
      const findSubfield = (tag: string, code: string, ind: string = '\\d\\d') => {
          const r = new RegExp(`=${tag}\\s+${ind}\\s+(?:\\$\\S[^$]*)*?\\$${code}([^$]+)`);
          const m = marcText.match(r); return m ? m[1].trim().replace(/[/\s.;,]+$/, '') : undefined;
      };
      const findSubfieldsInBlock = (tag: string, code: string, ind: string = '\\d\\d') => {
          const v: string[] = []; const fr = new RegExp(`^=${tag}\\s+${ind}\\s+.*$`, 'm'); const fm = marcText.match(fr);
          if (fm) { const fb = fm[0]; const sr = new RegExp(`\\$${code}([^$]+)`, 'g'); let sm; while ((sm = sr.exec(fb)) !== null) v.push(sm[1].trim().replace(/[/\s.;,]+$/, '')); } return v;
      };

      const tA = findSubfield('245', 'a'); const tB = findSubfield('245', 'b'); record.title = tA ? (tB ? `${tA}: ${tB}` : tA) : undefined;
      const a100 = findSubfield('100', 'a'); if (a100) record.authors?.push(a100); record.authors?.push(...findSubfieldsInBlock('700', 'a'));
      const eNames: string[] = []; const r700 = /^=700\s+\d\d\s+.*$/gm; let m700; while ((m700 = r700.exec(marcText)) !== null) { const fb = m700[0]; const rm = fb.match(/\$e(.*?)(?:$|\$)/); const nm = fb.match(/\$a(.*?)(?:$|\$)/); if (rm && nm && rm[1].trim().match(/edt|Hrsg|hrsg|editeur|éditeur/i)) eNames.push(nm[1].trim().replace(/[/\s.;,]+$/, '')); } record.editors = eNames; if (record.authors && record.editors) record.authors = record.authors.filter(a => !record.editors?.includes(a));
      const pl = findSubfield('260', 'a') || findSubfield('264', 'a', '.1'); const pub = findSubfield('260', 'b') || findSubfield('264', 'b', '.1'); const date = findSubfield('260', 'c') || findSubfield('264', 'c', '.1'); record.place_of_publication = pl; record.publisher_name = pub; if (date) { const ym = date.match(/(\d{4})/); record.year = ym ? ym[1] : undefined; }
      record.isbn = findSubfield('020', 'a')?.replace(/\s*\(.*?\)\s*$/, ''); record.issn = findSubfield('022', 'a'); record.series = findSubfield('490', 'a'); record.language = findSubfield('041', 'a'); record.subjects = findSubfieldsInBlock('650', 'a'); record.abstract = findSubfield('520', 'a');
      const lm = marcText.match(/=LDR\s+(\S{24})/); if (lm) { const l = lm[1]; const tc = l.length > 6 ? l[6] : '?'; const lc = l.length > 7 ? l[7] : '?'; record.format = this.mapMarcTypeToFormat(tc, lc); }
      const ht = findSubfield('773', 't'); const hi = findSubfield('773', 'g'); const isA = record.format === 'Journal Article' || record.issn; if (ht && isA) { record.journal_title = ht; if (hi) { const vm = hi.match(/(?:vol|v)\.?\s*(\d+)/i); const im = hi.match(/(?:no|nr|num)\.?\s*(\d+)/i); const pm = hi.match(/(?:pp|p)\.?\s*(\d+(?:-\d+)?)/i); record.volume = vm ? vm[1] : undefined; record.issue = im ? im[1] : undefined; record.pages = pm ? pm[1] : undefined; } } else if (ht) { record.series = ht; }
      record.urls = findSubfieldsInBlock('856', 'u', '4\\d');
      record.authors = record.authors || []; record.editors = record.editors || []; record.subjects = record.subjects || []; record.urls = record.urls || [];
    } catch (error: any) { log(`Error parsing MARC data: ${error.message}`, 'error'); }
    log(`Finished MARC parsing.`);
    return record;
  }

   /** Helper to map MARC LDR codes */
   private static mapMarcTypeToFormat(typeCode: string, levelCode: string): string | undefined {
       if (typeCode === 'a') { if (levelCode === 'm') return 'Book'; if (levelCode === 's') return 'Journal'; if (levelCode === 'a') return 'Journal Article'; if (levelCode === 'c') return 'Book Chapter'; if (levelCode === 'i') return 'Integrating Resource'; }
       if (typeCode === 't') return 'Book'; if (typeCode === 'c' || typeCode === 'd') return 'Music Score'; if (typeCode === 'e' || typeCode === 'f') return 'Map'; if (typeCode === 'g') return 'Video'; if (typeCode === 'i' || typeCode === 'j') return 'Music Recording'; if (typeCode === 'k') return 'Image'; if (typeCode === 'm') return 'Computer File'; if (typeCode === 'o') return 'Kit'; if (typeCode === 'p') return 'Mixed Materials'; if (typeCode === 'r') return 'Object';
       return undefined;
   }

  /**
   * Parse IxTheo HTML detail page
   * (Implementation remains the same as previously provided)
   */
  private static parseIxTheoDetailPageHtml(htmlText: string, log: (message: string, level?: 'log' | 'warn' | 'error') => void): Partial<BiblioRecord> {
    log(`Starting HTML detail page parsing...`);
    const record: Partial<BiblioRecord> = { authors: [], editors: [], subjects: [], urls: [] };
    record.raw_data = htmlText;
    try {
      const win = Zotero.getMainWindow(); if (!win || !win.DOMParser) throw new Error("DOMParser not available."); const parser = new win.DOMParser(); const doc = parser.parseFromString(htmlText, 'text/html');
      const findDetail = (lbl: string) => { const ths = doc.querySelectorAll('.description-tab table.table-striped th'); for (const th of ths) if (th.textContent?.trim().includes(lbl)) return (th.nextElementSibling as HTMLElement)?.textContent?.trim(); return undefined; };
      const findDetailMulti = (lbl: string, sel: string = 'span, a') => { const v: string[] = []; const ths = doc.querySelectorAll('.description-tab table.table-striped th'); for (const th of ths) if (th.textContent?.trim().includes(lbl)) { const td = th.nextElementSibling as HTMLElement; if (td) td.querySelectorAll(sel).forEach((el: Element) => { const txt = el.textContent?.trim(); if (txt && !v.includes(txt)) v.push(txt); }); break; } return v; };
      const findUrlsInDetail = (lbl: string) => { const u: string[] = []; const ths = doc.querySelectorAll('.description-tab table.table-striped th'); for (const th of ths) if (th.textContent?.trim().includes(lbl)) { const td = th.nextElementSibling as HTMLElement; td?.querySelectorAll('a[href]').forEach((lnk: Element) => { const hr = lnk.getAttribute('href'); if (hr && hr.startsWith('http') && !u.includes(hr)) u.push(hr); }); break; } return u; };

      record.title = doc.querySelector('h3[property="name"]')?.textContent?.trim(); record.authors = findDetailMulti('Author:', 'span[property="name"]'); record.format = findDetailMulti('Format:', 'span.format').join(', ') || undefined; record.language = findDetail('Language:');
      const pubTxt = findDetail('Published:'); if (pubTxt) { const ym = pubTxt.match(/(\d{4})/); record.year = ym ? ym[1] : undefined; let remTxt = pubTxt; if (record.year) remTxt = remTxt.replace(record.year, '').replace(/[,.\s]*$/, ''); const pts = remTxt.split(':'); if (pts.length > 1) { record.place_of_publication = pts[0].trim(); record.publisher_name = pts[1].split(',')[0].trim(); } else if (pts.length === 1 && !record.place_of_publication) { record.publisher_name = pts[0].trim(); } }
      const subjRows = doc.querySelectorAll('.description-tab table.table-striped th'); const subjSet = new Set<string>(); subjRows.forEach((th: Element) => { if (th.textContent?.trim().startsWith('Subject')) { const td = th.nextElementSibling as HTMLElement; td?.querySelectorAll('a').forEach((lnk: Element) => { const txt = lnk.textContent?.trim(); if (txt) subjSet.add(txt); }); } }); record.subjects = Array.from(subjSet);
      record.isbn = findDetail('ISBN:'); record.issn = findDetail('ISSN:'); record.extent = findDetail('Physical Description:'); record.series = findDetailMulti('Series', 'a')[0];
      const jnlTxt = findDetail('In:'); const thIn = (Array.from(doc.querySelectorAll('.description-tab table.table-striped th')) as Element[]).find(th => !!th.textContent?.trim().includes('In:')); if (thIn) { const tdIn = thIn.nextElementSibling as HTMLElement; const jnlLnk = tdIn?.querySelector('a'); record.journal_title = jnlLnk?.textContent?.trim() || jnlTxt?.split(',')[0].trim(); if (jnlTxt) { const vm = jnlTxt.match(/Volume:\s*(\d+)/i); const im = jnlTxt.match(/Issue:\s*(\d+)/i); const pm = jnlTxt.match(/Pages:\s*(\d+(?:-\d+)?)/i); record.volume = vm ? vm[1] : undefined; record.issue = im ? im[1] : undefined; record.pages = pm ? pm[1] : undefined; } }
      record.abstract = findDetail('Summary:'); record.urls = findUrlsInDetail('Online Access:'); record.doi = findDetail('DOI:');
      record.authors = record.authors || []; record.editors = record.editors || []; record.subjects = record.subjects || []; record.urls = record.urls || [];
    } catch (error: any) { log(`Error parsing IxTheo detail page HTML: ${error.message}`, 'error'); }
    log(`Finished HTML detail page parsing.`);
    return record;
  }

  /**
   * Build SRU query string based on parameters and endpoint specifics.
   * (SAFER version 2 - Prioritize DNB/ZDB known indexes)
   */
  private static buildSruQuery(
    params: import('./integration').SearchParams,
    endpointId: string
  ): string {
    const isDnbOrZdb = endpointId === 'dnb' || endpointId === 'zdb';

    // Prioritize allFieldsTerm
    if (params.allFieldsTerm?.trim()) {
        const searchTerm = params.allFieldsTerm.trim();
        return isDnbOrZdb ? `woe=${searchTerm}` : `cql.anywhere all "${searchTerm}"`; // Use woe for DNB/ZDB
    }

    const queryParts: string[] = [];
    const endpointInfo = SRU_ENDPOINTS[endpointId];
    const examples = endpointInfo?.examples || {};

    const formatPart = (key: 'title' | 'author' | 'isbn', value: string | undefined): string | null => {
        if (!value?.trim()) return null;
        const trimmedValue = value.trim();

        // --- START FIX: Prioritize DNB/ZDB known indexes ---
        if (isDnbOrZdb) {
            switch (key) {
                case 'title': return `TIT=${trimmedValue}`;
                case 'author': return `PER=${trimmedValue}`;
                case 'isbn': return (endpointId === 'zdb') ? `ISS=${trimmedValue}` : `NUM=${trimmedValue}`; // ZDB uses ISS for ISSN/ISBN? DNB uses NUM. Defaulting DNB to NUM.
            }
        }
        // --- END FIX ---

        // --- Fallback to using examples object (with safer access) ---
        const example = examples[key];
        if (example) {
            if (typeof example === 'string') {
                if (example.includes('=')) {
                    // Safer split and check
                    const parts = example.split('=', 2);
                    const prefix = parts[0].trim();
                    const suffixTemplate = parts[1] || ''; // Default to empty string if no suffix part
                    return suffixTemplate.trim().startsWith('"') ? `${prefix}="${trimmedValue}"` : `${prefix}=${trimmedValue}`;
                } else if (example.includes(' any ')) {
                    const [prefix] = example.split(' any ', 1);
                    return `${prefix} any "${trimmedValue}"`;
                } else if (example.includes(' all ')) {
                    const [prefix] = example.split(' all ', 1);
                    return `${prefix} all "${trimmedValue}"`;
                } else {
                    // Assume it's just a prefix if no operator/equals found
                    return `${example}=${trimmedValue}`; // Default to equals if unsure
                }
            } else if (typeof example === 'object' && example !== null) {
                const prefix = example.prefix || '';
                const operator = example.operator || '='; // Default operator
                if (prefix) {
                    return operator === '=' ? `${prefix}${trimmedValue}` : `${prefix} ${operator} "${trimmedValue}"`;
                }
            }
        }
        // --- End Fallback ---

        // --- Generic Fallback (if no DNB/ZDB and no example found) ---
        // This part might be less necessary now but kept for other endpoints
        switch (key) {
            case 'isbn': return (endpointId === 'bnf') ? `bib.isbn any "${trimmedValue}"` : `isbn=${trimmedValue}`;
            case 'author': return (endpointId === 'bnf') ? `bib.author any "${trimmedValue}"` : `author="${trimmedValue}"`;
            case 'title': return (endpointId === 'bnf') ? `bib.title any "${trimmedValue}"` : `title="${trimmedValue}"`;
        }
        return null;
    };

    // Build query parts (ISBN takes precedence if present)
    const isbnQuery = formatPart('isbn', params.isbn);
    if (isbnQuery) return isbnQuery; // If ISBN is searched, return only that

    const titleQuery = formatPart('title', params.title);
    const authorQuery = formatPart('author', params.author);
    if (titleQuery) queryParts.push(titleQuery);
    if (authorQuery) queryParts.push(authorQuery);

    if (queryParts.length === 0) {
        // Should not happen if validation passed, but return empty if it does
        ztoolkit.log("No valid SRU query parts generated.", 'warn');
        return '';
    }

    // Join multiple parts (e.g., title AND author)
    const joinOperator = (endpointId === 'bnf') ? ' and ' : ' AND ';
    return queryParts.join(joinOperator);
  }

   /**
    * Helper to show a debug dialog (implementation unchanged).
    */
   private static showDebugDialog(title: string, message: string, debugInfo: string): void {
        try {
          const dialogHelper = new ztoolkit.Dialog(12, 1)
            .addCell(0, 0, { tag: "h2", properties: { innerHTML: title } })
            .addCell(1, 0, { tag: "p", properties: { innerHTML: message } })
            .addCell(2, 0, { tag: "h3", properties: { innerHTML: "Debug Information:" } })
            .addCell(3, 0, {
              tag: "textarea", namespace: "html",
              attributes: { readonly: "true" },
              properties: { value: debugInfo, rows: 20, cols: 80 },
              styles: { width: "100%", fontFamily: "monospace", whiteSpace: "pre", fontSize: "12px" }
            })
            .addButton("Copy to Clipboard", "copy", {
              callback: () => {
                const win = dialogHelper.window;
                const textarea = win?.document.querySelector("textarea");
                if (textarea) {
                  textarea.select();
                  win?.document.execCommand("copy");
                }
              }, noClose: true
            })
            .addButton("Close", "close");
          dialogHelper.open(title, { width: 800, height: 600 });
        } catch (e) {
          console.error(`${title}: ${message}`);
          console.error(debugInfo);
          try { Zotero.getMainWindow()?.alert(`${title}\n\n${message}\n\n(See console for full debug info)`); } catch { /* ignore */ }
        }
   }

} // End of SearchService class