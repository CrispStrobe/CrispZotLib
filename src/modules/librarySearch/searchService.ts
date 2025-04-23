// src/modules/librarySearch/searchService.ts

import { BiblioRecord } from './models';
import { SRUClient } from './sruClient';
import { OAIClient } from './oaiClient';
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from './endpoints';
import { getPref } from '../../utils/prefs';

// Removed 'url' and 'cross-fetch' imports - use global versions

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
      isbn?: string; // ISN for IxTheo
      schema?: string; // For SRU
      maxRecords?: number;
      startRecord?: number; // For SRU/OAI pagination (IxTheo uses 'page')
    },
    log: (message: string, level?: 'log' | 'warn' | 'error') => void = ztoolkit.log // Default logger
  ): Promise<[boolean, BiblioRecord[], number]> { // Return total records count
    log(`Executing search with params: ${JSON.stringify(params)}`);
    try {
      switch (params.protocol.toLowerCase()) {
        case 'sru':
          return await this.executeSruSearch(params, log);
        case 'oai':
          // Note: OAI uses resumptionToken, not startRecord.
          return await this.executeOaiSearch(params, log);
        case 'ixtheo':
          // IxTheo uses 'page' parameter derived from startRecord and maxRecords
          const page = params.startRecord && params.maxRecords
            ? Math.floor((params.startRecord - 1) / params.maxRecords) + 1
            : 1;
          return await this.executeIxTheoSearch({
            ...params,
            page: page, // Pass calculated page number
            format: params.endpoint // Pass the selected format (ris, marc, html)
          }, log);
        default:
          throw new Error(`Unsupported protocol: ${params.protocol}`);
      }
    } catch (error: any) {
      log(`Search execution failed: ${error.message}`, 'error');
      return [false, [], 0]; // Return failure state with 0 total
    }
  }

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
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
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
          client = new SRUClient(
            endpointInfo.url,
            endpointInfo.defaultSchema,
            endpointInfo.version || '1.1'
          );
          this.sruClients[endpointId] = client;
        }

        let query = this.buildSruQuery(params, endpointId);
        if (!query) {
           log("SRU query is empty, proceeding if endpoint allows.", 'warn');
           // If an empty query should be an error, uncomment the line below
           // throw new Error("Failed to build SRU query - requires title, author, or ISBN");
        }
        log(`SRU Query: ${query}`);

        const schemaToUse = params.schema || endpointInfo.defaultSchema;
        log(`Using schema: ${schemaToUse || '(Endpoint Default)'}`);

        const [totalRecords, records] = await client.search(
          query,
          schemaToUse,
          params.maxRecords || 10,
          params.startRecord || 1
        );
        log(`SRU: Found ${totalRecords} total records, fetched ${records.length} starting from ${params.startRecord || 1}`);

        return [true, records, totalRecords]; // Return true even if no records found, but total is known

      } catch (error: any) {
        log(`SRU search error for endpoint ${params.endpoint}: ${error.message}`, 'error');
        return [false, [], 0]; // Indicate failure
      }
  }

  /**
 * Execute an OAI-PMH protocol search using the NEW OAIClient logic
 */
private static async executeOaiSearch(
  params: {
    endpoint: string;
    title?: string;
    author?: string;
    isbn?: string;
    maxRecords?: number;
  },
  log: (message: string, level?: 'log' | 'warn' | 'error') => void
): Promise<[boolean, BiblioRecord[], number]> {
  try {
    const endpointId = params.endpoint;

    if (!(endpointId in OAI_ENDPOINTS)) {
      throw new Error(`Unknown OAI-PMH endpoint: ${endpointId}`);
    }

    const endpointInfo = OAI_ENDPOINTS[endpointId];
    log(`Using OAI-PMH endpoint: ${endpointInfo.name}`);

    // Get or create OAI client using the NEW class
    let client = this.oaiClients[endpointId];
    if (!client) {
      client = new OAIClient(
        endpointInfo.url,
        endpointInfo.defaultMetadataPrefix
      );
      this.oaiClients[endpointId] = client;
    }

    // Build search query object
    const searchQuery: Record<string, string> = {};
    if (params.title) searchQuery.title = params.title;
    if (params.author) searchQuery.author = params.author;
    if (params.isbn) searchQuery.isbn = params.isbn; // Client handles ISBN/ISSN mapping internally if needed

    log(`OAI-PMH search criteria: ${JSON.stringify(searchQuery)}`);

    // Call the main search method of the NEW OAIClient
    // It will internally decide whether to use DNB logic or standard logic
    const [totalCount, records] = await client.search(
        searchQuery,
        endpointInfo.defaultMetadataPrefix,
        undefined, // set_spec (client might default for DNB)
        undefined, // from_date (client might default for DNB)
        undefined, // until_date (client might default for DNB)
        params.maxRecords || 10
    );

    log(`OAI-PMH: Client returned ${records.length} records, estimated total: ${totalCount}`);

    // The new client's search method handles DNB logic and filtering,
    // so we should be able to return the results directly.
    return [records.length > 0, records, totalCount];

  } catch (error: any) {
    log(`OAI search error for endpoint ${params.endpoint}: ${error.message}`, 'error');
    return [false, [], 0];
  }
}

  private static async executeOaiSearch_old(
    params: {
      endpoint: string;
      title?: string;
      author?: string;
      isbn?: string; // Consider mapping ISBN to a supported OAI query field if possible
      maxRecords?: number;
      // OAI uses resumptionToken, startRecord is ignored here
    },
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<[boolean, BiblioRecord[], number]> {
    try {
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
          endpointInfo.defaultMetadataPrefix
        );
        this.oaiClients[endpointId] = client;
      }
  
      // Build search query
      const searchQuery: Record<string, string> = {};
      if (params.title) searchQuery.title = params.title;
      if (params.author) searchQuery.author = params.author;
      if (params.isbn) searchQuery.isbn = params.isbn; // This will work for both ISBN and ISSN
  
      log(`OAI-PMH search criteria: ${JSON.stringify(searchQuery)}`);
  
      // Calculate appropriate date ranges
      // For DNB, narrower date range works better (prevents 413 errors)
      const isDNB = endpointId.toLowerCase().includes('dnb');
      let fromDate, untilDate;
  
      // Until date is always today
      untilDate = new Date().toISOString().split('T')[0];
  
      if (isDNB) {
        // For DNB, use a 3-month window (prevents 413 errors)
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        fromDate = threeMonthsAgo.toISOString().split('T')[0];
      } else {
        // For other repositories, one year is reasonable
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        fromDate = oneYearAgo.toISOString().split('T')[0];
      }
  
      // Execute search
      const [totalCount, records] = await client.search(
        searchQuery,
        endpointInfo.defaultMetadataPrefix,
        isDNB ? "dnb:reiheA" : undefined, // Use specific set for DNB to reduce result size
        fromDate,
        untilDate,
        params.maxRecords || 10
      );
  
      log(`OAI-PMH: Found ${totalCount} matching records, fetched ${records.length}`);
  
      // Return success status, the records, and the total count
      return [records.length > 0, records, totalCount];
    } catch (error: any) {
      log(`OAI search error for endpoint ${params.endpoint}: ${error.message}`);
      return [false, [], 0]; // Indicate failure
    }
  }

  /**
   * Execute an IxTheo search
   */
  private static async executeIxTheoSearch(
    params: {
      format: string; // User's choice: 'ris', 'marc', 'html'
      title?: string;
      author?: string;
      isbn?: string; // ISN (ISBN or ISSN)
      maxRecords?: number;
      page?: number; // Calculated page number
    },
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<[boolean, BiblioRecord[], number]> { // Return total count

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
      // Use global fetch
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

      const [parsedResults, totalCount] = this.parseIxTheoHtmlResultsPage(htmlText, log);
      log(`IxTheo HTML Parse: Found ${parsedResults.length} items on page, Total reported: ${totalCount}`);

      if (parsedResults.length === 0) {
        return [true, [], totalCount];
      }

      const detailedRecordsPromises = parsedResults.map(async ({ id, basicInfo }) => {
        try {
          // ADDED logging before fetch
          log(`Attempting to fetch details for IxTheo record ${id} (format: ${params.format})`, 'log');
          const detailedRecordData = await this.fetchIxTheoRecordDetails(id, params.format, endpointInfo.baseUrl, log);

          // ADDED logging after fetch
          if (detailedRecordData) {
              log(`Successfully fetched/parsed details for ${id}. Data: ${JSON.stringify(detailedRecordData).substring(0, 200)}...`, 'log');
          } else {
              log(`fetchIxTheoRecordDetails returned null for ${id}.`, 'warn');
          }

          if (detailedRecordData) {
            const finalRecord: BiblioRecord = {
                title: "Untitled", authors: [], editors: [], translators: [], contributors: [],
                urls: [], subjects: [],
                ...basicInfo,
                ...detailedRecordData,
                id: id,
                schema: `ixtheo-${params.format}`,
                raw_data: detailedRecordData.raw_data || basicInfo.raw_data,
            };
            finalRecord.authors = finalRecord.authors || [];
            finalRecord.editors = finalRecord.editors || [];
            finalRecord.translators = finalRecord.translators || [];
            finalRecord.contributors = finalRecord.contributors || [];
            finalRecord.urls = finalRecord.urls || [];
            finalRecord.subjects = finalRecord.subjects || [];
            // ADDED logging of final merged record
            log(`Final merged record for ${id}: ${JSON.stringify(finalRecord).substring(0, 300)}...`, 'log');
            return finalRecord;
          } else {
            log(`Falling back to basic info for IxTheo record ${id}.`, 'warn');
             const fallbackRecord = {
                 id: id, title: basicInfo.title || "Untitled",
                 authors: basicInfo.authors || [], editors: basicInfo.editors || [],
                 translators: basicInfo.translators || [], contributors: basicInfo.contributors || [],
                 urls: basicInfo.urls || [], subjects: basicInfo.subjects || [],
                 year: basicInfo.year, publisher_name: basicInfo.publisher_name,
                 format: basicInfo.format, raw_data: basicInfo.raw_data,
                 schema: 'ixtheo-html-basic'
             } as BiblioRecord;
             // ADDED logging of fallback record
             log(`Fallback record for ${id}: ${JSON.stringify(fallbackRecord).substring(0, 300)}...`, 'log');
             return fallbackRecord;
          }
        } catch (detailError: any) {
          log(`Error processing IxTheo record ${id}: ${detailError.message}`, 'error');
            const errorRecord = {
                 id: id, title: basicInfo.title || "Untitled",
                 authors: basicInfo.authors || [], editors: basicInfo.editors || [],
                 translators: basicInfo.translators || [], contributors: basicInfo.contributors || [],
                 urls: basicInfo.urls || [], subjects: basicInfo.subjects || [],
                 year: basicInfo.year, publisher_name: basicInfo.publisher_name,
                 format: basicInfo.format, raw_data: basicInfo.raw_data,
                 schema: 'ixtheo-error'
             } as BiblioRecord;
             // ADDED logging of error record
             log(`Error record for ${id}: ${JSON.stringify(errorRecord).substring(0, 300)}...`, 'log');
             return errorRecord;
        }
      });

      const detailedRecords = (await Promise.all(detailedRecordsPromises))
                                .filter((record): record is BiblioRecord => record !== null);

      log(`IxTheo: Successfully processed ${detailedRecords.length} records overall.`);
      return [true, detailedRecords, totalCount];

    } catch (error: any) {
      log(`Error in executeIxTheoSearch: ${error.message}`, 'error');
      return [false, [], 0];
    }
  }

  /** Helper to build IxTheo Search URL */
  private static buildIxTheoSearchUrl(
      params: { title?: string; author?: string; isbn?: string; maxRecords?: number; page?: number; },
      baseUrl: string // Pass the base search URL (e.g., https://ixtheo.de/Search/Results)
  ): string {
      // Use global URLSearchParams
      const queryParams = new URLSearchParams();
      const searchTerms: string[] = [];

      // Combine search terms - IxTheo uses specific prefixes like title:, author:, isn:
      if (params.title) searchTerms.push(`title:(${params.title})`); // Use parentheses for phrase?
      if (params.author) searchTerms.push(`author:(${params.author})`);
      if (params.isbn) searchTerms.push(`isn:(${params.isbn})`); // isn covers ISBN/ISSN

      if (searchTerms.length > 0) {
          queryParams.append('lookfor', searchTerms.join(' ')); // Combine with space
          queryParams.append('type', 'AllFields'); // Use AllFields when combining prefixes
      } else {
          // Handle case with no search terms if needed, maybe default query?
          queryParams.append('lookfor', '*'); // Example: search everything
          queryParams.append('type', 'AllFields');
      }

      queryParams.append('limit', String(params.maxRecords || 10));
      queryParams.append('sort', 'relevance'); // Or 'year desc' etc.
      // queryParams.append('view', 'list'); // This seems default

      if (params.page && params.page > 1) {
          queryParams.append('page', String(params.page));
      }

      // Add bot protection parameter if needed (seems required based on Python)
      queryParams.append('botprotect', '');

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

      // --- Extract total results count (REFINED v2) ---
      // Priority 1: Look for data-record-total attribute
      const statsDiv = doc.querySelector('div.search-stats');
      const dataTotal = statsDiv?.getAttribute('data-record-total');

      if (dataTotal && /^\d+$/.test(dataTotal)) {
          totalCount = parseInt(dataTotal, 10);
          log(`Extracted total count from data-record-total: ${totalCount}`);
      } else {
          // Priority 2: Fallback to parsing text content if attribute missing/invalid
          log('data-record-total attribute not found or invalid. Falling back to text parsing.', 'warn');
          const summarySelectors = [
              '.resultHeader .resultcount',
              '.search-stats .pager-text .js-search-stats', // More specific
              '.search-stats',
              '.pagination-summary',
              '.result_count',
              '#result_count'
          ];
          let summaryElement: Element | null = null;
          for (const selector of summarySelectors) {
              summaryElement = doc.querySelector(selector);
              if (summaryElement?.textContent) {
                  log(`Found summary text element with selector: ${selector}`);
                  break;
              }
          }

          if (summaryElement?.textContent) {
              const summaryText = summaryElement.textContent;
              log(`Found summary text: "${summaryText}"`);
              // Regex to find the number after "of", "von", "de", "sur" or the last number
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
      // --- End Total Count Extraction ---


      // Extract result items (logic remains the same)
      const resultItems = doc.querySelectorAll('.result');
      log(`Found ${resultItems.length} result items on HTML page`);

      resultItems.forEach((item: Element, index: number) => {
        let recordId: string | null = null;
        const basicInfo: Partial<BiblioRecord> = { authors: [], subjects: [], urls: [], editors: [], translators: [], contributors: [] }; // Initialize arrays

        // --- Extract Record ID (Try multiple methods) ---
        // 1. Hidden input .hiddenId
        const hiddenIdInput = item.querySelector('.hiddenId') as HTMLInputElement;
        if (hiddenIdInput?.value) {
          recordId = hiddenIdInput.value;
        }
        // 2. Checkbox value (format Solr|ID)
        if (!recordId) {
          const checkbox = item.querySelector('input.checkbox-select-item') as HTMLInputElement;
          if (checkbox?.value && checkbox.value.includes('|')) {
            recordId = checkbox.value.split('|')[1];
          }
        }
        // 3. From li id and corresponding hidden form input (more complex)
        if (!recordId) {
            const liId = item.getAttribute('id');
            if (liId && liId.startsWith('result')) {
                try {
                    const resultIndexMatch = liId.match(/\d+$/);
                    if (resultIndexMatch) {
                        const resultIndex = parseInt(resultIndexMatch[0], 10);
                        // Find the corresponding hidden input in the main form based on index
                        const hiddenInputs = doc.querySelectorAll('form[name="bulkActionForm"] input[name="idsAll[]"]');
                        // Adjust index if results are 1-based but querySelectorAll is 0-based
                        const actualIndex = resultIndex -1; // Assuming li id="result1" corresponds to first hidden input
                        if (actualIndex >= 0 && actualIndex < hiddenInputs.length) {
                            const hiddenValue = (hiddenInputs[actualIndex] as HTMLInputElement)?.value;
                             if (hiddenValue && hiddenValue.includes('|')) {
                                recordId = hiddenValue.split('|')[1];
                            }
                        } else {
                             log(`Index ${actualIndex} out of bounds for hidden inputs (length ${hiddenInputs.length})`, 'warn');
                        }
                    }
                } catch (e) { log(`Error parsing ID from li element: ${e}`, 'warn'); }
            }
        }


        if (!recordId) {
          log(`Could not find record ID for item index ${index}`, 'warn');
          return; // Skip item if no ID found
        }

        // --- Extract Basic Metadata ---
        // Title
        const titleElem = item.querySelector('.title a');
        basicInfo.title = titleElem?.textContent?.trim() || 'Untitled';

        // Authors
        const authorElem = item.querySelector('.author');
        if (authorElem?.textContent) {
            const authorText = authorElem.textContent.trim();
            // Split authors, handle potential "(Author)" suffix
            basicInfo.authors = authorText.split(';')
                                       .map(a => a.replace(/\s*\(Author\)$/i, '').trim())
                                       .filter(Boolean);
        }

        // Format(s)
        const formatElems = item.querySelectorAll('.format');
        // FIXED: Cast Array.from result before mapping
        const formats = (Array.from(formatElems) as Element[]).map((el: Element) => el.textContent?.trim()).filter(Boolean);
        basicInfo.format = formats.join(', ') || undefined; // Join multiple formats

        // Year
        const yearElem = item.querySelector('.publishDate');
        if (yearElem?.textContent) {
          const yearMatch = yearElem.textContent.match(/\b(1[89]\d{2}|20\d{2})\b/);
          basicInfo.year = yearMatch ? yearMatch[0] : undefined;
        }

         // Publisher (less common on results page, but try)
         const publisherElem = item.querySelector('.publisher');
         basicInfo.publisher_name = publisherElem?.textContent?.trim() || undefined;

         // Subjects (often linked)
         const subjectLinks = item.querySelectorAll('.subject a');
         // FIXED: Cast Array.from result before mapping
         basicInfo.subjects = (Array.from(subjectLinks) as Element[]).map((a: Element) => a.textContent?.trim()).filter(Boolean) as string[];

         // Raw HTML snippet for debugging
         // FIXED: Cast outerHTML to string
         basicInfo.raw_data = item.outerHTML as string;

        results.push({ id: recordId, basicInfo });
      });

       // If totalCount wasn't found, estimate based on parsed items and page (less reliable)
       if (totalCount === 0 && results.length > 0) {
           totalCount = results.length; // Fallback for the current page
           log(`Total count not found in HTML, using parsed count for this page: ${totalCount}`, 'warn');
       }

    } catch (error: any) {
      log(`Error parsing IxTheo HTML results page: ${error.message}`, 'error');
      return [[], 0]; // Return empty on error
    }
    return [results, totalCount];
  }

  /**
   * Fetches and parses detailed data for a single IxTheo record.
   */
  private static async fetchIxTheoRecordDetails(
    recordId: string,
    format: string,
    baseUrl: string,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<Partial<BiblioRecord> | null> {
    // ADDED logging
    log(`Fetching details for IxTheo record ${recordId} in format: ${format}`, 'log');
    try {
      let resultData: string | null = null;
      let parsedRecord: Partial<BiblioRecord> | null = null;

      if (format === 'ris') {
        resultData = await this.fetchIxTheoExportData(recordId, 'RIS', baseUrl, log);
        if (resultData) {
            parsedRecord = this.parseIxTheoRis(resultData, log);
        }
      } else if (format === 'marc') {
        resultData = await this.fetchIxTheoExportData(recordId, 'MARC', baseUrl, log);
         if (resultData) {
            parsedRecord = this.parseIxTheoMarc(resultData, log);
        }
      } else if (format === 'html') {
        resultData = await this.fetchIxTheoDetailPage(recordId, baseUrl, log);
         if (resultData) {
            parsedRecord = this.parseIxTheoDetailPageHtml(resultData, log);
        }
      } else {
        log(`Unsupported detail format requested: ${format}. Falling back to RIS.`, 'warn');
        resultData = await this.fetchIxTheoExportData(recordId, 'RIS', baseUrl, log);
         if (resultData) {
            parsedRecord = this.parseIxTheoRis(resultData, log);
        }
      }

      // ADDED logging of fetch/parse outcome
      if (parsedRecord) {
          log(`Successfully fetched and parsed ${format} for ${recordId}.`, 'log');
      } else {
          log(`Failed to get valid ${format} data for ${recordId}. Fetch returned: ${resultData === null ? 'null' : 'data (length ' + resultData?.length + ')'}`, 'warn');
      }
      return parsedRecord;

    } catch (error: any) {
      log(`Error in fetchIxTheoRecordDetails for ${recordId} (${format}): ${error.message}`, 'error');
      return null;
    }
  }

  /** Fetches RIS or MARC export data */
  private static async fetchIxTheoExportData(
    recordId: string,
    exportFormat: 'RIS' | 'MARC',
    baseUrl: string,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<string | null> {
    // FIXED: Use style=RIS instead of RISPlusAbstract
    const exportUrl = `${baseUrl}/Record/${recordId}/Export?style=${exportFormat}`;
    // ADDED logging
    log(`Fetching ${exportFormat} export from URL: ${exportUrl}`, 'log');
    try {
       const response = await fetch(exportUrl, {
           headers: {
               'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
               'Accept': 'text/plain, */*; q=0.01',
               'X-Requested-With': 'XMLHttpRequest',
               'Referer': `${baseUrl}/Record/${recordId}`,
           }
       });

        // ADDED logging of response status and headers
       log(`Response status for ${exportFormat} export ${recordId}: ${response.status}`, 'log');
       try {
            log(`Response headers for ${exportFormat} export ${recordId}: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`, 'log');
       } catch (headerErr) {
            log(`Could not stringify headers for ${recordId}: ${headerErr}`, 'warn');
       }


       if (!response.ok) {
        // Log HTTP errors before throwing
        log(`Export request failed for ${recordId} with HTTP status: ${response.status} ${response.statusText}`, 'error');
        throw new Error(`Export request failed with HTTP status: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('Content-Type');
      const expectedContentType = exportFormat === 'RIS' ? 'application/x-research-info-systems' : 'application/marc';
      const isPlainText = contentType?.includes('text/plain'); // Common for RIS
      const isHtml = contentType?.includes('text/html');
      const data = await response.text();

      // ADDED logging of response body beginning
      log(`Response body beginning for ${exportFormat} export ${recordId} (Content-Type: ${contentType}):\n${data.substring(0, 300)}...`, 'log');


      // REFINED Check: Look for the error message *first*
      if (data.includes("The selected export format is not supported by this record")) {
          log(`IxTheo reported export format ${exportFormat} not supported for record ${recordId}. Reason: Explicit message found.`, 'warn');
          return null; // Indicate failure gracefully
      }

      // THEN check content type if no explicit error message
      if (isHtml || (!contentType?.includes(expectedContentType) && !(exportFormat === 'RIS' && isPlainText)) ) {
          log(`Unexpected content type received for ${exportFormat} export ${recordId}: ${contentType}. Body did not contain known error message.`, 'warn');
          // Treat as failure if content type is wrong *and* no known error message was present
          return null;
          // Or throw: throw new Error(`Unexpected content type for ${exportFormat} export: ${contentType}`);
      }


      if (!data.trim()) {
          log(`Export returned empty response for ${recordId} (${exportFormat}). Reason: Empty body.`, 'warn');
          return null;
      }

      log(`${exportFormat} data received and appears valid for ${recordId} (length: ${data.length})`, 'log');
      return data; // Success

    } catch (error: any) {
      // Catch fetch errors or errors thrown above
      log(`Error fetching ${exportFormat} export for ${recordId}. Reason: ${error.message}`, 'error');
      return null; // Indicate failure
    }
  }

  /** Fetches the HTML detail page */
  private static async fetchIxTheoDetailPage(
    recordId: string,
    baseUrl: string,
    log: (message: string, level?: 'log' | 'warn' | 'error') => void
  ): Promise<string | null> {
    const detailUrl = `${baseUrl}/Record/${recordId}`;
     log(`Fetching HTML detail page from: ${detailUrl}`);
    try {
       // Use global fetch
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
   */
  private static parseIxTheoRis(risText: string, log: (message: string, level?: 'log' | 'warn' | 'error') => void): Partial<BiblioRecord> {
    // ADDED logging
    log(`Starting RIS parsing. Input data (first 300 chars):\n${risText.substring(0, 300)}...`, 'log');
    const record: Partial<BiblioRecord> = { authors: [], editors: [], translators: [], urls: [], subjects: [] };
    record.raw_data = risText;

    try {
      const lines = risText.split(/[\r\n]+/); // Split by newline
      let currentTag = '';
      let currentValue = '';
      let startPage: string | undefined = undefined; // Keep track of start page separately

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // RIS format: TAG  - Value
        const match = trimmedLine.match(/^([A-Z][A-Z0-9])\s{2,}-\s?(.*)$/);
        if (match) {
          currentTag = match[1];
          currentValue = match[2].trim();

          switch (currentTag) {
            case 'TY': record.format = this.mapRisTypeToFormat(currentValue); break;
            case 'TI': case 'T1': record.title = currentValue; break;
            case 'AU': case 'A1': record.authors?.push(currentValue); break;
            case 'ED': case 'A2': record.editors?.push(currentValue); break; // A2 often used for editors too
            case 'A4': record.translators?.push(currentValue); break; // A4 for Translator
            case 'PY': case 'Y1':
              const yearMatch = currentValue.match(/(\d{4})/);
              if (yearMatch) record.year = yearMatch[1];
              break;
            case 'PB': record.publisher_name = currentValue; break;
            case 'CY': record.place_of_publication = currentValue; break;
            case 'SN': // ISBN or ISSN
              const cleanedSN = currentValue.replace(/[- ]/g, '');
              if (/^\d{4}\d{3}[\dX]$/.test(cleanedSN)) { record.issn = currentValue; }
              else { record.isbn = currentValue.replace(/\s*\(.*?\)\s*$/, ''); } // Clean ISBN
              break;
            case 'T2': case 'JO': case 'JA': case 'JF': // Journal Title or Book Title (for chapters)
                // Use existing format if already determined, otherwise guess based on ISSN
                const format = record.format || (record.issn ? 'Journal Article' : 'Book Chapter');
                if (format === 'Journal Article') { record.journal_title = currentValue; }
                else { record.series = currentValue; } // Assume book title/series otherwise
                break;
            case 'VL': record.volume = currentValue; break;
            case 'IS': record.issue = currentValue; break;
            case 'SP': startPage = currentValue; break; // Store start page
            case 'EP': // End page - combine with start page later
              if (startPage && !startPage.includes('-')) { record.pages = `${startPage}-${currentValue}`; }
              else if (!startPage) { record.pages = currentValue; } // Only end page found
              break;
            case 'UR': case 'L1': record.urls?.push(currentValue); break; // URL, L1 is primary URL
            case 'AB': case 'N2': record.abstract = currentValue; break; // Abstract or Note 2
            case 'KW': record.subjects?.push(currentValue); break; // Keywords
            case 'LA': record.language = currentValue; break; // Language
            case 'DO': record.doi = currentValue; break; // DOI
            case 'ET': record.edition = currentValue; break; // Edition
            // Add other tags as needed: M1, M3, etc.
          }
        } else if (currentTag && trimmedLine) {
          // Handle continuation lines (though less common in basic RIS)
          // log(`Continuation line for tag ${currentTag}: ${trimmedLine}`, 'warn');
        }
      }

      // Finalize pages field if only start page was found
      if (startPage && !record.pages) {
          record.pages = startPage;
      }

       // Ensure arrays are initialized even if empty
       record.authors = record.authors || [];
       record.editors = record.editors || [];
       record.translators = record.translators || [];
       record.urls = record.urls || [];
       record.subjects = record.subjects || [];

    } catch (error: any) {
      log(`Error parsing RIS data: ${error.message}`, 'error');
    }
    log(`Finished RIS parsing. Result: ${JSON.stringify(record).substring(0, 300)}...`, 'log');
    return record;
  }

  /** Helper to map RIS TY field to a more descriptive format string */
  private static mapRisTypeToFormat(risType: string): string | undefined {
      const typeMap: Record<string, string> = {
          'JOUR': 'Journal Article', 'BOOK': 'Book', 'CHAP': 'Book Chapter',
          'THES': 'Thesis', 'CONF': 'Conference Paper', 'RPRT': 'Report',
          'SER': 'Journal', 'MAP': 'Map', 'MUSIC': 'Music Score', // Add others as needed
          'GEN': 'Generic', 'ELEC': 'Electronic Resource'
      };
      return typeMap[risType] || risType; // Return mapped value or original if not found
  }


  /**
   * Parse IxTheo MARC formatted results (basic regex implementation)
   */
  private static parseIxTheoMarc(marcText: string, log: (message: string, level?: 'log' | 'warn' | 'error') => void): Partial<BiblioRecord> {
    log(`Starting MARC parsing. Input data (first 300 chars):\n${marcText.substring(0, 300)}...`, 'log');
    const record: Partial<BiblioRecord> = { authors: [], editors: [], subjects: [], urls: [] };
     record.raw_data = marcText; // Store raw data

    try {
      // Helper to find subfield value
      const findSubfield = (fieldTag: string, subfieldCode: string, indicators: string = '\\d\\d'): string | undefined => {
          // Regex: =TAG indicators $CODE value ($ not captured)
          // Allow for optional subfields between indicators and target subfield
          const regex = new RegExp(`=${fieldTag}\\s+${indicators}\\s+(?:\\$\\S[^$]*)*?\\$${subfieldCode}([^$]+)`);
          const match = marcText.match(regex);
          return match ? match[1].trim().replace(/[/\s.;,]+$/, '') : undefined; // Clean trailing punctuation
      };
       // Helper to find multiple subfield values
      const findSubfields = (fieldTag: string, subfieldCode: string, indicators: string = '\\d\\d'): string[] => {
          const values: string[] = [];
           // Regex: =TAG indicators (any subfields)* $CODE value ($ not captured) - Global search
          const regex = new RegExp(`=${fieldTag}\\s+${indicators}\\s+(?:\\$\\S[^$]*)*?\\$${subfieldCode}([^$]+)`, 'g');
          let match;
          while ((match = regex.exec(marcText)) !== null) {
              values.push(match[1].trim().replace(/[/\s.;,]+$/, ''));
          }
          return values;
      };
       // Helper to find specific field block and then subfields within it
      const findSubfieldsInBlock = (fieldTag: string, subfieldCode: string, indicators: string = '\\d\\d'): string[] => {
          const values: string[] = [];
          // Find the whole field block first
          const fieldRegex = new RegExp(`^=${fieldTag}\\s+${indicators}\\s+.*$`, 'm'); // Find the start of the field line
          const fieldMatch = marcText.match(fieldRegex);
          if (fieldMatch) {
              const fieldBlock = fieldMatch[0];
              // Now find the specific subfield within that block
              const subfieldRegex = new RegExp(`\\$${subfieldCode}([^$]+)`, 'g');
              let subMatch;
              while ((subMatch = subfieldRegex.exec(fieldBlock)) !== null) {
                   values.push(subMatch[1].trim().replace(/[/\s.;,]+$/, ''));
              }
          }
          return values;
      };


      // --- Extract Fields ---
      // Title (245 $a, $b)
      const titleA = findSubfield('245', 'a');
      const titleB = findSubfield('245', 'b');
      record.title = titleA ? (titleB ? `${titleA}: ${titleB}` : titleA) : undefined;

      // Authors (100 $a, 700 $a)
      const author100 = findSubfield('100', 'a');
      if (author100) record.authors?.push(author100);
      record.authors?.push(...findSubfieldsInBlock('700', 'a')); // Use findSubfieldsInBlock for potentially multiple 700s

      // Editors (check 700 $e) - More robust check
      const editorNames: string[] = [];
      const field700Regex = /^=700\s+\d\d\s+.*$/gm; // Find all 700 fields
      let field700Match;
      while ((field700Match = field700Regex.exec(marcText)) !== null) {
          const fieldBlock = field700Match[0];
          const roleMatch = fieldBlock.match(/\$e(.*?)(?:$|\$)/);
          const nameMatch = fieldBlock.match(/\$a(.*?)(?:$|\$)/);
          if (roleMatch && nameMatch && roleMatch[1].trim().match(/edt|Hrsg|hrsg|editeur|éditeur/i)) {
              editorNames.push(nameMatch[1].trim().replace(/[/\s.;,]+$/, ''));
          }
      }
       record.editors = editorNames;
       // Remove editors from authors list if found
       if (record.authors && record.editors) {
           record.authors = record.authors.filter(a => !record.editors?.includes(a));
       }


      // Publication (260/264 $a=place, $b=publisher, $c=year)
      const place = findSubfield('260', 'a') || findSubfield('264', 'a', '.1'); // 264 ind2=1 for publication
      const publisher = findSubfield('260', 'b') || findSubfield('264', 'b', '.1');
      const pubDate = findSubfield('260', 'c') || findSubfield('264', 'c', '.1');
      record.place_of_publication = place;
      record.publisher_name = publisher;
      if (pubDate) {
          const yearMatch = pubDate.match(/(\d{4})/);
          record.year = yearMatch ? yearMatch[1] : undefined;
      }

      // ISBN (020 $a)
      record.isbn = findSubfield('020', 'a')?.replace(/\s*\(.*?\)\s*$/, ''); // Clean qualifiers

      // ISSN (022 $a)
      record.issn = findSubfield('022', 'a');

      // Series (490 $a)
      record.series = findSubfield('490', 'a');

      // Language (041 $a) - Basic, gets code
      record.language = findSubfield('041', 'a');

      // Subjects (650 $a)
      record.subjects = findSubfieldsInBlock('650', 'a'); // Use findSubfieldsInBlock

      // Abstract (520 $a)
      record.abstract = findSubfield('520', 'a');

      // Format from Leader (LDR pos 6)
       const leaderMatch = marcText.match(/=LDR\s+(\S{24})/);
       if (leaderMatch) {
           const leader = leaderMatch[1];
           const typeCode = leader.length > 6 ? leader[6] : '?';
           const levelCode = leader.length > 7 ? leader[7] : '?';
           record.format = this.mapMarcTypeToFormat(typeCode, levelCode);
       }

      // Journal Info (773 $t=title, $g=vol/issue/pages)
      const hostTitle = findSubfield('773', 't');
      const hostInfo = findSubfield('773', 'g'); // Get the whole $g
       // Determine if it's likely an article based on format or ISSN presence
       const isArticle = record.format === 'Journal Article' || record.issn;

      if (hostTitle && isArticle) {
          record.journal_title = hostTitle;
          if (hostInfo) {
              // More specific regex for vol/issue/pages within $g
              const volMatch = hostInfo.match(/(?:vol|v)\.?\s*(\d+)/i);
              const issueMatch = hostInfo.match(/(?:no|nr|num)\.?\s*(\d+)/i);
              const pagesMatch = hostInfo.match(/(?:pp|p)\.?\s*(\d+(?:-\d+)?)/i);
              record.volume = volMatch ? volMatch[1] : undefined;
              record.issue = issueMatch ? issueMatch[1] : undefined;
              record.pages = pagesMatch ? pagesMatch[1] : undefined;
          }
      } else if (hostTitle) {
          // If not an article, host title might be book title for a chapter
          record.series = hostTitle;
      }


      // URLs (856 $u)
      record.urls = findSubfieldsInBlock('856', 'u', '4\\d'); // Ind1=4 for http

       // Ensure arrays are initialized
       record.authors = record.authors || [];
       record.editors = record.editors || [];
       record.subjects = record.subjects || [];
       record.urls = record.urls || [];

    } catch (error: any) {
      log(`Error parsing MARC data (regex): ${error.message}`, 'error');
    }
    log(`Finished MARC parsing. Result: ${JSON.stringify(record).substring(0, 300)}...`, 'log');
    return record;
  }

   /** Helper to map MARC LDR/06 and LDR/07 codes to a format string */
   private static mapMarcTypeToFormat(typeCode: string, levelCode: string): string | undefined {
       // Based on https://www.loc.gov/marc/bibliographic/bdleader.html
       if (typeCode === 'a') { // Language material
           if (levelCode === 'm') return 'Book';
           if (levelCode === 's') return 'Journal'; // Serial
           if (levelCode === 'a') return 'Journal Article'; // Analytic component part (often article)
           if (levelCode === 'c') return 'Book Chapter'; // Collection
           if (levelCode === 'i') return 'Integrating Resource'; // e.g., loose-leaf
       }
       if (typeCode === 't') return 'Book'; // Manuscript language material
       if (typeCode === 'c' || typeCode === 'd') return 'Music Score'; // Notated music
       if (typeCode === 'e' || typeCode === 'f') return 'Map'; // Cartographic
       if (typeCode === 'g') return 'Video'; // Projected medium
       if (typeCode === 'i' || typeCode === 'j') return 'Music Recording'; // Nonmusical/Musical sound recording
       if (typeCode === 'k') return 'Image'; // 2D graphic
       if (typeCode === 'm') return 'Computer File'; // Software, electronic resource
       if (typeCode === 'o') return 'Kit';
       if (typeCode === 'p') return 'Mixed Materials';
       if (typeCode === 'r') return 'Object'; // 3D artifact

       return undefined; // Unknown or not mapped
   }

  /**
   * Parse IxTheo HTML detail page
   */
  private static parseIxTheoDetailPageHtml(htmlText: string, log: (message: string, level?: 'log' | 'warn' | 'error') => void): Partial<BiblioRecord> {
    log(`Starting HTML detail page parsing. Input data (first 300 chars):\n${htmlText.substring(0, 300)}...`, 'log');
    const record: Partial<BiblioRecord> = { authors: [], editors: [], subjects: [], urls: [] };
    record.raw_data = htmlText; // Store raw HTML

    try {
      // FIXED: Use Zotero.getMainWindow() for DOMParser
      const win = Zotero.getMainWindow();
      if (!win || !win.DOMParser) {
         // Log specific error if main window or DOMParser is missing
        log("DOMParser not available via Zotero.getMainWindow()", 'error');
        throw new Error("DOMParser not available.");
      }
      const parser = new win.DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');


      // Helper to get text from next TD after a TH containing specific text
      const findDetail = (label: string): string | undefined => {
          const thElements = doc.querySelectorAll('.description-tab table.table-striped th');
          for (const th of thElements) {
              // Use includes for partial matches, trim whitespace
              if (th.textContent?.trim().includes(label)) {
                  const td = th.nextElementSibling as HTMLElement;
                  // Get text, potentially cleaning up nested spans/links if needed
                  return td?.textContent?.trim() || undefined;
              }
          }
          return undefined;
      };
       // Helper to get text from potentially multiple spans/links within the next TD
      const findDetailMulti = (label: string, selector: string = 'span, a'): string[] => {
          const values: string[] = [];
          const thElements = doc.querySelectorAll('.description-tab table.table-striped th');
          for (const th of thElements) {
               if (th.textContent?.trim().includes(label)) {
                   const td = th.nextElementSibling as HTMLElement;
                   if (td) {
                       td.querySelectorAll(selector).forEach((el: Element) => { // FIXED: Added type Element
                           const text = el.textContent?.trim();
                           // Avoid adding empty strings or duplicates
                           if (text && !values.includes(text)) values.push(text);
                       });
                   }
                   break; // Assume first match is correct
               }
           }
           return values;
      };
       // Helper to get URL from link(s) in next TD
       const findUrlsInDetail = (label: string): string[] => {
           const urls: string[] = [];
           const thElements = doc.querySelectorAll('.description-tab table.table-striped th');
           for (const th of thElements) {
               if (th.textContent?.trim().includes(label)) {
                   const td = th.nextElementSibling as HTMLElement;
                   td?.querySelectorAll('a[href]').forEach((link: Element) => { // FIXED: Added type Element
                       const href = link.getAttribute('href');
                       if (href && href.startsWith('http') && !urls.includes(href)) {
                           urls.push(href);
                       }
                   });
                   break; // Assume first match is correct
               }
           }
           return urls;
       };


      // --- Extract Fields ---
      // Title (h3 property="name")
      record.title = doc.querySelector('h3[property="name"]')?.textContent?.trim();

      // Authors (spans with property="name" in Author row)
      record.authors = findDetailMulti('Author:', 'span[property="name"]');

      // Format (spans with class="format" in Format row)
      record.format = findDetailMulti('Format:', 'span.format').join(', ') || undefined;

      // Language
      record.language = findDetail('Language:');

      // Publication Info (Published: row)
      const publishedText = findDetail('Published:');
      if (publishedText) {
          // Try to extract place, publisher, year
          // More robust extraction: handle cases like "Place : Publisher, Year" or just "Place : Publisher" or "Year"
          const yearMatch = publishedText.match(/(\d{4})/);
          record.year = yearMatch ? yearMatch[1] : undefined;

          let remainingText = publishedText;
          if (record.year) {
              remainingText = remainingText.replace(record.year, '').replace(/[,.\s]*$/, ''); // Remove year and trailing punctuation
          }

          const parts = remainingText.split(':');
          if (parts.length > 1) {
              record.place_of_publication = parts[0].trim();
              record.publisher_name = parts[1].split(',')[0].trim(); // Take part after colon, before first comma
          } else if (parts.length === 1 && !record.place_of_publication) {
              // If only one part and no place yet, assume it might be the place or publisher
              record.publisher_name = parts[0].trim(); // Default to publisher
          }
      }

      // Subjects (links in Subject row(s)) - Find all subject rows
       const subjectRows = doc.querySelectorAll('.description-tab table.table-striped th');
       const subjectsSet = new Set<string>(); // Use a Set to avoid duplicates
       subjectRows.forEach((th: Element) => { // FIXED: Added type Element
           if (th.textContent?.trim().startsWith('Subject')) {
               const td = th.nextElementSibling as HTMLElement;
               td?.querySelectorAll('a').forEach((link: Element) => { // FIXED: Added type Element
                   const text = link.textContent?.trim();
                   if (text) subjectsSet.add(text);
               });
           }
       });
       record.subjects = Array.from(subjectsSet);


      // ISBN/ISSN
      record.isbn = findDetail('ISBN:');
      record.issn = findDetail('ISSN:');

      // Extent/Physical Description
      record.extent = findDetail('Physical Description:');

      // Series (link in Series row)
      record.series = findDetailMulti('Series', 'a')[0]; // Assuming single series link

      // Journal Info (In: row)
      const journalText = findDetail('In:');
       // FIXED: Cast Array.from result and ensure predicate returns boolean
       const thIn = (Array.from(doc.querySelectorAll('.description-tab table.table-striped th')) as Element[])
                    .find((th: Element) => !!th.textContent?.trim().includes('In:'));

       if (thIn) { // FIXED: Moved logic inside the guard
           const tdIn = thIn.nextElementSibling as HTMLElement; // Access is safe within the guard
           const journalLink = tdIn?.querySelector('a');
           record.journal_title = journalLink?.textContent?.trim() || journalText?.split(',')[0].trim();

           if (journalText) {
               const volMatch = journalText.match(/Volume:\s*(\d+)/i);
               const issueMatch = journalText.match(/Issue:\s*(\d+)/i);
               const pagesMatch = journalText.match(/Pages:\s*(\d+(?:-\d+)?)/i);
               record.volume = volMatch ? volMatch[1] : undefined;
               record.issue = issueMatch ? issueMatch[1] : undefined;
               record.pages = pagesMatch ? pagesMatch[1] : undefined;
           }
       }


      // Abstract/Summary
      record.abstract = findDetail('Summary:');

      // URLs (Online Access: row, links with class 'fulltext')
      record.urls = findUrlsInDetail('Online Access:');

       // DOI (Look for DOI: label)
       record.doi = findDetail('DOI:');


       // Ensure arrays are initialized
       record.authors = record.authors || [];
       record.editors = record.editors || []; // HTML parsing might not easily get editors
       record.subjects = record.subjects || [];
       record.urls = record.urls || [];

    } catch (error: any) {
      log(`Error parsing IxTheo detail page HTML: ${error.message}`, 'error');
    }
    log(`Finished HTML detail page parsing. Result: ${JSON.stringify(record).substring(0, 300)}...`, 'log');
    return record;
  }


  private static buildSruQuery(
    params: {
      title?: string;
      author?: string;
      isbn?: string;
    },
    endpointId: string
  ): string {
     const endpointInfo = SRU_ENDPOINTS[endpointId];
    const examples = endpointInfo?.examples || {};
    const queryParts: string[] = [];

    const formatPart = (key: 'title' | 'author' | 'isbn', value: string | undefined): string | null => {
        if (!value) return null;

        const example = examples[key];
        if (example) {
            // Use example format if available
            if (typeof example === 'string') {
                if (example.includes('=')) {
                    const parts = example.split('=');
                    const prefix = parts[0].trim();
                    const isQuoted = parts[1].trim().startsWith('"');
                    return isQuoted ? `${prefix}="${value}"` : `${prefix}=${value}`;
                } else if (example.includes(' any ')) {
                    const parts = example.split(' any ');
                    return `${parts[0]} any "${value}"`;
                } else if (example.includes(' all ')) {
                     const parts = example.split(' all ');
                     return `${parts[0]} all "${value}"`;
                }
            } else if (typeof example === 'object') {
                 // Handle advanced example structure if needed (e.g., DNB)
                 // This part might need refinement based on how examples are structured
                 ztoolkit.log(`Using advanced example structure for ${key} - needs specific handling`, 'warn');
                 // Example fallback for DNB-like structure
                 const prefix = Object.keys(example)[0]; // e.g., TIT
                 return `${prefix}=${value}`;
            }
        }
        // Fallback formats if no example matches
        switch (key) {
            case 'isbn':
                switch (endpointId) {
                    case 'dnb': return `ISBN=${value}`;
                    case 'bnf': return `bib.isbn any "${value}"`;
                    case 'zdb': return `ISS=${value}`; // ZDB uses ISS for ISSN/ISBN
                    default: return `isbn=${value}`; // Common default
                }
            case 'author':
                 switch (endpointId) {
                    case 'dnb': return `PER=${value}`;
                    case 'bnf': return `bib.author any "${value}"`;
                    default: return `author="${value}"`; // Common default
                }
            case 'title':
                 switch (endpointId) {
                    case 'dnb': return `TIT=${value}`;
                    case 'bnf': return `bib.title any "${value}"`;
                    default: return `title="${value}"`; // Common default
                }
        }
        return null;
    };


    // Prioritize ISBN
    const isbnQuery = formatPart('isbn', params.isbn);
    if (isbnQuery) return isbnQuery;

    // Combine Title and Author
    const titleQuery = formatPart('title', params.title);
    const authorQuery = formatPart('author', params.author);

    if (titleQuery) queryParts.push(titleQuery);
    if (authorQuery) queryParts.push(authorQuery);

    if (queryParts.length === 0) {
        return ''; // Or handle error/default query
    }

    // Join with appropriate operator (AND is common, BNF uses 'and')
    const joinOperator = (endpointId === 'bnf') ? ' and ' : ' AND ';
    return queryParts.join(joinOperator);
  }

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
          try {
            Zotero.getMainWindow()?.alert(`${title}\n\n${message}\n\n(See console for full debug info)`);
          } catch { /* ignore */ }
        }
   }

} // End of SearchService class