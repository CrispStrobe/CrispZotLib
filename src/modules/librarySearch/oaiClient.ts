// src/modules/librarySearch/oaiClient.ts
// OAI-PMH protocol client implementation - Fixed version

import { BiblioRecord } from "./models";
import { fetchWithTimeout, readXml } from "./httpUtils";
import {
  collectOaiRecordElements,
  findResumptionTokenElement,
  processOaiRecordElement,
  ParserLog,
} from "./oaiRecordParser";

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
    private readonly _defaultMetadataPrefix: string = "oai_dc",
    private readonly _timeout: number = 30000,
  ) {
    // Ensure DOMParser is available in the Zotero environment
    if (typeof DOMParser === "undefined") {
      // Fallback or error if DOMParser is not globally available
      // In Zotero's context, it should be.
      console.error("DOMParser is not available in this context!");
      throw new Error("DOMParser is required but not available.");
    }
    this.parser = new DOMParser();
    this.defaultMetadataPrefix = _defaultMetadataPrefix;
    this.timeout = _timeout;
  }

  /**
   * Parse an XML string, throwing on a <parsererror> (PLAN 2.5). DOMParser
   * reports malformed/truncated XML by injecting a <parsererror> element into
   * the document rather than throwing, so without this check a broken response
   * is silently indistinguishable from a legitimate empty result. Each caller's
   * try/catch turns the throw into a logged failure instead of "0 results".
   */
  private parseXml(xmlText: string): Document {
    const doc = this.parser.parseFromString(xmlText, "application/xml");
    const errs = doc.getElementsByTagName("parsererror");
    if (errs && errs.length > 0) {
      const detail = (errs[0].textContent || "").slice(0, 200);
      ztoolkit.log(`OAI response was not well-formed XML: ${detail}`, "error");
      throw new Error("OAI response was not well-formed XML");
    }
    return doc;
  }

  /**
   * Build OAI-PMH request URL
   */
  buildUrl(verb: string, params: Record<string, string> = {}): string {
    const parameters = new URLSearchParams();
    parameters.append("verb", verb);

    // Add additional parameters, ensuring values are strings
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // Only add defined parameters
        parameters.append(key, String(value));
      }
    }

    // Construct URL
    const separator = this.baseUrl.includes("?") ? "&" : "?";
    return `${this.baseUrl}${separator}${parameters.toString()}`;
  }

  /**
   * Main search method for OAI-PMH. Orchestrates the search process,
   * handling resumption tokens and DNB-specific logic.
   *
   * @param metadataPrefix Metadata format to request (mandatory).
   * @param set_spec Optional set for filtering.
   * @param from_date Optional start date (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ).
   * @param until_date Optional end date (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ).
   * @param filterQuery Optional dictionary of terms for local filtering (e.g., { title: "...", author: "..." }).
   * @param max_results Maximum number of results to return *after* filtering.
   * @param resumptionToken Optional token for fetching the next page of results.
   * @returns A Promise resolving to a tuple: [estimated total count, array of BiblioRecord, next resumption token or null].
   */
  async search(
    metadataPrefix: string,
    set_spec?: string,
    from_date?: string,
    until_date?: string,
    filterQuery: Record<string, string> = {},
    max_results: number = 10,
    resumptionToken?: string,
  ): Promise<[number, BiblioRecord[], string | null]> {
    const logPrefix = "[OAIClient.search]";
    try {
      // Ensure metadataPrefix is provided
      const prefixToUse = metadataPrefix || this.defaultMetadataPrefix;
      if (!prefixToUse) {
        throw new Error("metadataPrefix is required for OAI-PMH search.");
      }

      // --- Handle Resumption Token ---
      if (resumptionToken) {
        console.log(
          `${logPrefix} Resuming search with token: ${resumptionToken}`,
        );
        ztoolkit.log(`${logPrefix} Resuming search with token.`);
        // When resuming, we ignore other parameters except the token
        // Filtering and max_results are applied after fetching the page.
        const [total, records, nextToken] = await this.listOrResumeRecords(
          prefixToUse, // Pass prefix for parsing, though not used in request
          undefined, // set
          undefined, // from
          undefined, // until
          resumptionToken, // THE important part
        );

        // Apply filtering and limit
        const filteredRecords =
          Object.keys(filterQuery).length > 0
            ? records.filter((record) =>
                this.record_matches_query(record, filterQuery),
              )
            : records;

        const finalRecords = filteredRecords.slice(0, max_results);
        // Note: The 'total' returned by listOrResumeRecords might be from the token,
        // but it refers to the *original* query, not the filtered count.
        // Returning filteredRecords.length might be more accurate for the current page context.
        console.log(
          `${logPrefix} Resumption returned ${records.length} records, filtered to ${finalRecords.length}. Next token: ${nextToken}`,
        );
        ztoolkit.log(
          `${logPrefix} Resumption returned ${records.length}, filtered to ${finalRecords.length}.`,
        );
        return [filteredRecords.length, finalRecords, nextToken]; // Return filtered count for this page
      }

      // --- Handle Initial Search (No Resumption Token) ---
      const is_dnb = this.baseUrl.toLowerCase().includes("dnb");

      // DNB needs a bounded date range (and a default set) or it rejects the
      // harvest; otherwise it uses the same ListRecords path as every other
      // endpoint. ListRecords returns full metadata in one request and pages
      // via resumptionToken — verified live against services.dnb.de (50
      // records/page + token, HTTP 200, no 413). This replaces the former
      // ListIdentifiers + per-ID GetRecord path, which issued one GetRecord per
      // identifier (N+1: ~51 requests for 50 records) and had no pagination.
      const { from, until } = is_dnb
        ? this.ensureDateRange(from_date, until_date, true) // force a range for DNB
        : this.ensureDateRange(from_date, until_date, false);
      const setToUse = is_dnb ? set_spec || "dnb" : set_spec;

      console.log(
        `${logPrefix} Using standard path (ListRecords).${is_dnb ? " [DNB: forced date range + default set]" : ""}`,
      );
      ztoolkit.log(`${logPrefix} Using standard path (ListRecords).`);

      const [total, records, nextToken] = await this.listOrResumeRecords(
        prefixToUse,
        setToUse,
        from,
        until,
        undefined, // No resumption token for initial request
      );

      // Apply filtering and limit
      const filteredRecords =
        Object.keys(filterQuery).length > 0
          ? records.filter((record) =>
              this.record_matches_query(record, filterQuery),
            )
          : records;

      const finalRecords = filteredRecords.slice(0, max_results);
      // Similar note as above: 'total' might be from the token and refer to unfiltered size.
      console.log(
        `${logPrefix} Standard path returned ${records.length} records, filtered to ${finalRecords.length}. Next token: ${nextToken}`,
      );
      ztoolkit.log(
        `${logPrefix} Standard path returned ${records.length}, filtered to ${finalRecords.length}.`,
      );
      return [filteredRecords.length, finalRecords, nextToken]; // Return filtered count for this page
    } catch (e: any) {
      console.error(`${logPrefix} Error: ${e.message}`);
      ztoolkit.log(`${logPrefix} Error: ${e.message}`, "error");
      return [0, [], null]; // Return empty result on error
    }
  }

  /**
   * Helper to ensure a valid date range, especially for DNB.
   */
  private ensureDateRange(
    from?: string,
    until?: string,
    forceForDNB: boolean = false,
  ): { from?: string; until?: string } {
    let finalFrom = from;
    let finalUntil = until;

    if (forceForDNB) {
      // DNB requires dates. If not provided, create a default range.
      if (!finalUntil) {
        finalUntil = new Date().toISOString().split("T")[0]; // Today
      }
      if (!finalFrom) {
        // Default to 3 months prior for DNB safety
        const untilDateObj = new Date(finalUntil);
        untilDateObj.setMonth(untilDateObj.getMonth() - 3);
        finalFrom = untilDateObj.toISOString().split("T")[0];
      }
    } else {
      // For non-DNB or if not forced, only ensure consistency if one date is given
      if (finalFrom && !finalUntil) {
        finalUntil = new Date().toISOString().split("T")[0]; // Today
      } else if (finalUntil && !finalFrom) {
        // Default to 1 year prior if only until is given
        const untilDateObj = new Date(finalUntil);
        untilDateObj.setFullYear(untilDateObj.getFullYear() - 1);
        finalFrom = untilDateObj.toISOString().split("T")[0];
      }
    }
    return { from: finalFrom, until: finalUntil };
  }

  /**
   * Standard search approach using ListRecords or resuming with a token.
   * Applies filtering *after* fetching a page of records.
   * This method replaces the old `searchWithRecords` and `list_records`.
   */
  private async listOrResumeRecords(
    metadataPrefix: string,
    set_spec?: string,
    from_date?: string,
    until_date?: string,
    resumptionToken?: string,
  ): Promise<[number, BiblioRecord[], string | null]> {
    // Returns total, records, next token
    const logPrefix = "[OAIClient.listOrResumeRecords]";
    try {
      const params: Record<string, string> = {};
      let url = "";

      // Build URL based on whether it's an initial request or resumption
      if (resumptionToken) {
        params["resumptionToken"] = resumptionToken;
        url = this.buildUrl("ListRecords", params);
        console.log(`${logPrefix} Resuming ListRecords: ${url}`);
        ztoolkit.log(`${logPrefix} Resuming ListRecords with token.`);
      } else {
        params["metadataPrefix"] = metadataPrefix;
        if (set_spec) params["set"] = set_spec;
        if (from_date) params["from"] = from_date;
        if (until_date) params["until"] = until_date;
        url = this.buildUrl("ListRecords", params);
        console.log(`${logPrefix} Executing initial ListRecords: ${url}`);
        ztoolkit.log(`${logPrefix} Executing initial ListRecords.`);
      }

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/xml" } },
        this.timeout,
        2,
      );

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => "Could not read error response body");
        console.error(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}. Body: ${errorText}`,
        );
        ztoolkit.log(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}`,
          "error",
        );
        throw new Error(
          `OAI ListRecords request failed: ${response.status} ${response.statusText}`,
        );
      }

      const xmlText = await readXml(response);
      const xmlDoc = this.parseXml(xmlText);

      // Check for OAI-PMH protocol level errors
      const oaiError = this.checkForErrors(xmlDoc);
      if (oaiError) {
        if (oaiError.includes("noRecordsMatch")) {
          console.log(`${logPrefix} OAI-PMH info: noRecordsMatch`);
          ztoolkit.log(`${logPrefix} OAI-PMH info: noRecordsMatch`);
          return [0, [], null]; // No records match, return empty, no token
        }
        if (oaiError.includes("badResumptionToken")) {
          console.warn(
            `${logPrefix} OAI-PMH warning: badResumptionToken. Stopping pagination.`,
          );
          ztoolkit.log(
            `${logPrefix} OAI-PMH warning: badResumptionToken.`,
            "warn",
          );
          return [0, [], null]; // Invalid token, stop here
        }
        // For other errors, log and throw
        console.error(`${logPrefix} OAI-PMH error: ${oaiError}`);
        ztoolkit.log(`${logPrefix} OAI-PMH error: ${oaiError}`, "error");
        throw new Error(`OAI-PMH error: ${oaiError}`);
      }

      // Extract records from this page (shared with the offline replay tests;
      // deleted/unparseable records come back as null and are skipped)
      const records: BiblioRecord[] = [];
      for (const recordElement of collectOaiRecordElements(xmlDoc)) {
        const record = processOaiRecordElement(
          recordElement,
          metadataPrefix || this.defaultMetadataPrefix,
          this.parserLog,
        );
        if (record) {
          records.push(record);
        }
      }

      // Extract the next resumption token
      const nextTokenElement = findResumptionTokenElement(xmlDoc);
      const nextResumptionToken = nextTokenElement?.textContent?.trim() || null;

      // Extract total count if available (often unreliable, especially with filtering)
      let totalCount = 0;
      if (nextTokenElement?.hasAttribute("completeListSize")) {
        totalCount = parseInt(
          nextTokenElement.getAttribute("completeListSize") || "0",
          10,
        );
      } else if (!nextResumptionToken) {
        // If it's the last page (no token), the total might just be the records found so far
        // This is an estimate, especially if filtering is applied later.
        totalCount = records.length; // Or potentially a sum if tracking across pages
      }
      // If totalCount is still 0 but we have records, use records.length as a minimum estimate
      if (totalCount === 0 && records.length > 0) {
        totalCount = records.length;
      }

      console.log(
        `${logPrefix} Fetched ${records.length} records. Estimated total: ${totalCount}. Next token: ${nextResumptionToken ? "..." : "null"}`,
      );
      ztoolkit.log(
        `${logPrefix} Fetched ${records.length} records. Next token: ${nextResumptionToken ? "..." : "null"}`,
      );

      // Return estimated total, records for *this page*, and the next token
      return [totalCount, records, nextResumptionToken];
    } catch (e: any) {
      // Catch network errors or errors thrown above
      console.error(
        `${logPrefix} Error fetching/parsing ListRecords: ${e.message}`,
      );
      ztoolkit.log(
        `${logPrefix} Error fetching/parsing ListRecords: ${e.message}`,
        "error",
      );
      return [0, [], null]; // Return empty on error
    }
  }

  /**
   * List available sets in the repository using the ListSets verb.
   *
   * @returns A Promise resolving to a Record mapping setSpec (string) to setName (string).
   *          Returns an empty object on error or if no sets are available.
   */
  async listSets(): Promise<Record<string, string>> {
    const logPrefix = "[OAIClient.listSets]"; // For easier log filtering
    try {
      const url = this.buildUrl("ListSets");
      console.log(`${logPrefix} Executing: ${url}`);
      ztoolkit.log(`${logPrefix} Executing: ${url}`); // Use ztoolkit logger too

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/xml" } },
        this.timeout,
        2,
      );

      if (!response.ok) {
        // Log detailed error before throwing
        const errorText = await response
          .text()
          .catch(() => "Could not read error response body");
        console.error(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}. Body: ${errorText}`,
        );
        ztoolkit.log(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}`,
          "error",
        );
        throw new Error(
          `OAI ListSets request failed: ${response.status} ${response.statusText}`,
        );
      }

      const xmlText = await readXml(response);
      const xmlDoc = this.parseXml(xmlText);

      // Check for OAI-PMH protocol level errors first
      const oaiError = this.checkForErrors(xmlDoc);
      if (oaiError) {
        // Handle 'noSetHierarchy' gracefully - it just means no sets exist
        if (oaiError.includes("noSetHierarchy")) {
          console.log(
            `${logPrefix} Repository reports no set hierarchy (no sets available).`,
          );
          ztoolkit.log(`${logPrefix} Repository reports no set hierarchy.`);
          return {}; // Return empty object, not an error
        }
        // For other OAI errors, log and return empty or throw
        console.error(`${logPrefix} OAI-PMH error: ${oaiError}`);
        ztoolkit.log(`${logPrefix} OAI-PMH error: ${oaiError}`, "error");
        // Depending on desired behavior, you might throw here or return empty
        // return {}; // Return empty for robustness
        throw new Error(`OAI-PMH error: ${oaiError}`);
      }

      // If no OAI error, parse the sets
      const sets: Record<string, string> = {};
      // Query for 'set' elements directly under 'ListSets'
      // Using namespace wildcard *| for robustness against default namespace variations
      const setElements = xmlDoc.querySelectorAll(
        "ListSets > set, *|ListSets > *|set",
      );

      setElements.forEach((setElement: Element) => {
        // Find setSpec and setName within each setElement
        const setSpecElement = setElement.querySelector("setSpec, *|setSpec");
        const setNameElement = setElement.querySelector("setName, *|setName");

        // Ensure both elements and their text content exist
        if (setSpecElement?.textContent && setNameElement?.textContent) {
          const spec = setSpecElement.textContent.trim();
          const name = setNameElement.textContent.trim();
          // Add to record only if spec is not empty
          if (spec) {
            sets[spec] = name;
          } else {
            console.warn(
              `${logPrefix} Found a set with an empty setSpec. Skipping.`,
            );
            ztoolkit.log(
              `${logPrefix} Found a set with an empty setSpec. Skipping.`,
              "warn",
            );
          }
        } else {
          console.warn(
            `${logPrefix} Found a set element missing setSpec or setName. Skipping.`,
          );
          ztoolkit.log(
            `${logPrefix} Found a set element missing setSpec or setName. Skipping.`,
            "warn",
          );
        }
      });

      console.log(`${logPrefix} Found ${Object.keys(sets).length} sets.`);
      ztoolkit.log(`${logPrefix} Found ${Object.keys(sets).length} sets.`);
      return sets;
    } catch (e: any) {
      // Catch network errors or errors thrown above
      console.error(
        `${logPrefix} Error fetching or parsing ListSets: ${e.message}`,
      );
      ztoolkit.log(
        `${logPrefix} Error fetching or parsing ListSets: ${e.message}`,
        "error",
      );
      // Return empty object on any failure to prevent UI crashes
      return {};
    }
  }

  /**
   * List available metadata formats in the repository using the ListMetadataFormats verb.
   * Optionally, list formats available for a specific identifier.
   *
   * @param identifier Optional OAI identifier to list formats for a specific record.
   * @returns A Promise resolving to an array of metadata prefix strings.
   *          Returns an empty array on error.
   */
  async listMetadataFormats(identifier?: string): Promise<string[]> {
    const logPrefix = "[OAIClient.listMetadataFormats]";
    try {
      const params: Record<string, string> = {};
      if (identifier) {
        params["identifier"] = identifier;
      }

      const url = this.buildUrl("ListMetadataFormats", params);
      console.log(`${logPrefix} Executing: ${url}`);
      ztoolkit.log(`${logPrefix} Executing: ${url}`);

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/xml" } },
        this.timeout,
        2,
      );

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => "Could not read error response body");
        console.error(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}. Body: ${errorText}`,
        );
        ztoolkit.log(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}`,
          "error",
        );
        throw new Error(
          `OAI ListMetadataFormats request failed: ${response.status} ${response.statusText}`,
        );
      }

      const xmlText = await readXml(response);
      const xmlDoc = this.parseXml(xmlText);

      // Check for OAI-PMH protocol level errors
      const oaiError = this.checkForErrors(xmlDoc);
      if (oaiError) {
        // Handle idDoesNotExist gracefully if querying for a specific identifier
        if (identifier && oaiError.includes("idDoesNotExist")) {
          console.warn(
            `${logPrefix} Identifier '${identifier}' does not exist.`,
          );
          ztoolkit.log(
            `${logPrefix} Identifier '${identifier}' does not exist.`,
            "warn",
          );
          return []; // Return empty array
        }
        console.error(`${logPrefix} OAI-PMH error: ${oaiError}`);
        ztoolkit.log(`${logPrefix} OAI-PMH error: ${oaiError}`, "error");
        // return []; // Return empty for robustness
        throw new Error(`OAI-PMH error: ${oaiError}`);
      }

      // If no OAI error, parse the formats
      const formats: string[] = [];
      // Query for 'metadataFormat' elements directly under 'ListMetadataFormats'
      const formatElements = xmlDoc.querySelectorAll(
        "ListMetadataFormats > metadataFormat, *|ListMetadataFormats > *|metadataFormat",
      );

      formatElements.forEach((formatElement: Element) => {
        const prefixElement = formatElement.querySelector(
          "metadataPrefix, *|metadataPrefix",
        );
        // Ensure element and text content exist and prefix is not empty
        if (prefixElement?.textContent) {
          const prefix = prefixElement.textContent.trim();
          if (prefix && !formats.includes(prefix)) {
            // Add only non-empty, unique prefixes
            formats.push(prefix);
          }
        } else {
          console.warn(
            `${logPrefix} Found a metadataFormat element missing metadataPrefix. Skipping.`,
          );
          ztoolkit.log(
            `${logPrefix} Found a metadataFormat element missing metadataPrefix. Skipping.`,
            "warn",
          );
        }
      });

      console.log(
        `${logPrefix} Found ${formats.length} metadata formats: ${formats.join(", ")}`,
      );
      ztoolkit.log(
        `${logPrefix} Found ${formats.length} metadata formats: ${formats.join(", ")}`,
      );
      return formats;
    } catch (e: any) {
      // Catch network errors or errors thrown above
      console.error(
        `${logPrefix} Error fetching or parsing ListMetadataFormats: ${e.message}`,
      );
      ztoolkit.log(
        `${logPrefix} Error fetching or parsing ListMetadataFormats: ${e.message}`,
        "error",
      );
      // Return empty array on any failure
      return [];
    }
  }

  /**
   * List record identifiers with optional filtering.
   * NOTE: This method fetches only the first batch of identifiers.
   * Full resumption token handling for ListIdentifiers is complex and often not needed
   * if the primary goal is to feed identifiers into GetRecord for filtering.
   */
  async listIdentifiers(
    metadata_prefix: string = "",
    set_spec?: string, // Made optional
    from_date?: string, // Made optional
    until_date?: string, // Made optional
    max_results: number = 100, // Limit how many identifiers we fetch in one go
  ): Promise<Array<any>> {
    // Returns array of { identifier, datestamp, setSpec } or { error }
    const logPrefix = "[OAIClient.listIdentifiers]";
    try {
      metadata_prefix = metadata_prefix || this.defaultMetadataPrefix;
      if (!metadata_prefix) {
        throw new Error(
          "metadataPrefix is required for OAI-PMH ListIdentifiers.",
        );
      }

      // Build parameters
      const params: Record<string, string> = {
        metadataPrefix: metadata_prefix,
      };

      if (set_spec) params["set"] = set_spec;
      if (from_date) params["from"] = from_date;
      if (until_date) params["until"] = until_date;

      const url = this.buildUrl("ListIdentifiers", params);
      console.log(`${logPrefix} Executing: ${url}`);
      ztoolkit.log(`${logPrefix} Executing ListIdentifiers.`);

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/xml" } },
        this.timeout,
        2,
      );

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => "Could not read error response body");
        console.error(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}. Body: ${errorText}`,
        );
        ztoolkit.log(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}`,
          "error",
        );
        throw new Error(
          `OAI ListIdentifiers request failed: ${response.status} ${response.statusText}`,
        );
      }

      const xmlText = await readXml(response);
      const xmlDoc = this.parseXml(xmlText);

      // Check for OAI-PMH protocol level errors
      const oaiError = this.checkForErrors(xmlDoc);
      if (oaiError) {
        if (oaiError.includes("noRecordsMatch")) {
          console.log(`${logPrefix} OAI-PMH info: noRecordsMatch`);
          ztoolkit.log(`${logPrefix} OAI-PMH info: noRecordsMatch`);
          return []; // No records match
        }
        console.error(`${logPrefix} OAI-PMH error: ${oaiError}`);
        ztoolkit.log(`${logPrefix} OAI-PMH error: ${oaiError}`, "error");
        // Return error object in array for consistency, though maybe empty array is better
        return [{ error: `OAI-PMH error: ${oaiError}` }];
      }

      // Extract identifiers from this response page
      const identifiers: Array<any> = [];
      // Query for 'header' elements directly under 'ListIdentifiers'
      const headerElements = xmlDoc.querySelectorAll(
        "ListIdentifiers > header, *|ListIdentifiers > *|header",
      );

      for (let i = 0; i < headerElements.length; i++) {
        // Stop if we reach the requested max_results for this batch
        if (max_results && identifiers.length >= max_results) {
          break;
        }

        const header = headerElements[i];

        // Skip deleted records
        if (header.getAttribute("status") === "deleted") {
          continue;
        }

        const identifierElement = header.querySelector(
          "identifier, *|identifier",
        );
        const datestampElement = header.querySelector("datestamp, *|datestamp");

        if (identifierElement?.textContent) {
          const identifier = identifierElement.textContent.trim();
          const datestamp = datestampElement?.textContent?.trim() || "";

          // Get setSpec elements (can be multiple)
          const sets: string[] = [];
          const setSpecElements = header.querySelectorAll("setSpec, *|setSpec");
          setSpecElements.forEach((setSpec: Element) => {
            if (setSpec.textContent) {
              sets.push(setSpec.textContent.trim());
            }
          });

          if (identifier) {
            // Ensure identifier is not empty
            identifiers.push({ identifier, datestamp, setSpec: sets });
          }
        }
      }

      // Check for resumption token - log it but don't follow automatically in this basic version
      const resumptionTokenElement = xmlDoc.querySelector(
        "resumptionToken, *|resumptionToken",
      );
      const resumptionToken =
        resumptionTokenElement?.textContent?.trim() || null;
      if (resumptionToken) {
        console.log(
          `${logPrefix} More identifiers might be available via resumptionToken (not automatically fetched).`,
        );
        ztoolkit.log(
          `${logPrefix} More identifiers might be available via resumptionToken.`,
        );
      }

      console.log(
        `${logPrefix} Found ${identifiers.length} identifiers in this batch.`,
      );
      ztoolkit.log(
        `${logPrefix} Found ${identifiers.length} identifiers in this batch.`,
      );
      return identifiers;
    } catch (e: any) {
      // Catch network errors or errors thrown above
      console.error(
        `${logPrefix} Error fetching or parsing ListIdentifiers: ${e.message}`,
      );
      ztoolkit.log(
        `${logPrefix} Error fetching or parsing ListIdentifiers: ${e.message}`,
        "error",
      );
      return []; // Return empty array on error
    }
  }

  /**
   * Get a specific record by identifier
   */
  async getRecord(
    identifier: string,
    metadataPrefix: string = "",
  ): Promise<BiblioRecord | null> {
    const logPrefix = "[OAIClient.getRecord]";
    try {
      const prefixToUse = metadataPrefix || this.defaultMetadataPrefix;
      if (!prefixToUse) {
        throw new Error("metadataPrefix is required for OAI-PMH GetRecord.");
      }
      if (!identifier) {
        throw new Error("identifier is required for OAI-PMH GetRecord.");
      }

      const params = {
        identifier: identifier,
        metadataPrefix: prefixToUse,
      };

      const url = this.buildUrl("GetRecord", params);
      console.log(`${logPrefix} Executing: ${url}`);
      ztoolkit.log(`${logPrefix} Executing GetRecord for ${identifier}.`);

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/xml" } },
        this.timeout,
        2,
      );

      if (!response.ok) {
        // Handle specific errors like idDoesNotExist more gracefully
        if (response.status === 404 || response.status === 400) {
          // Assuming 404 or 400 might indicate missing ID
          const errorTextCheck = await response.text().catch(() => "");
          if (errorTextCheck.includes("idDoesNotExist")) {
            console.warn(
              `${logPrefix} Identifier '${identifier}' does not exist.`,
            );
            ztoolkit.log(
              `${logPrefix} Identifier '${identifier}' does not exist.`,
              "warn",
            );
            return null; // Not found is not a fatal error for this operation
          }
        }
        // For other errors, log and throw/return null
        const errorText = await response
          .text()
          .catch(() => "Could not read error response body");
        console.error(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}. Body: ${errorText}`,
        );
        ztoolkit.log(
          `${logPrefix} Request failed: ${response.status} ${response.statusText}`,
          "error",
        );
        // throw new Error(`OAI GetRecord request failed: ${response.status} ${response.statusText}`);
        return null; // Return null on error
      }

      const xmlText = await readXml(response);
      const xmlDoc = this.parseXml(xmlText);

      // Check for OAI-PMH protocol level errors
      const oaiError = this.checkForErrors(xmlDoc);
      if (oaiError) {
        if (oaiError.includes("idDoesNotExist")) {
          console.warn(
            `${logPrefix} Identifier '${identifier}' does not exist (reported by OAI).`,
          );
          ztoolkit.log(
            `${logPrefix} Identifier '${identifier}' does not exist (reported by OAI).`,
            "warn",
          );
          return null; // Not found
        }
        console.error(`${logPrefix} OAI-PMH error: ${oaiError}`);
        ztoolkit.log(`${logPrefix} OAI-PMH error: ${oaiError}`, "error");
        // throw new Error(`OAI-PMH error in GetRecord: ${oaiError}`);
        return null; // Return null on error
      }

      // Extract record element
      const recordElement = collectOaiRecordElements(xmlDoc)[0];
      if (!recordElement) {
        console.warn(
          `${logPrefix} No record element found in response for identifier ${identifier}.`,
        );
        ztoolkit.log(
          `${logPrefix} No record element found for ${identifier}.`,
          "warn",
        );
        return null;
      }

      // Process the record using the correct metadata prefix
      const record = processOaiRecordElement(
        recordElement,
        prefixToUse,
        this.parserLog,
      );
      if (record) {
        console.log(
          `${logPrefix} Successfully processed record ${identifier}.`,
        );
        ztoolkit.log(
          `${logPrefix} Successfully processed record ${identifier}.`,
        );
      }
      return record;
    } catch (e: any) {
      // Catch network errors or errors thrown above
      console.error(
        `${logPrefix} Error fetching or parsing GetRecord for ${identifier}: ${e.message}`,
      );
      ztoolkit.log(
        `${logPrefix} Error fetching or parsing GetRecord for ${identifier}: ${e.message}`,
        "error",
      );
      return null; // Return null on error
    }
  }

  // Record parsing lives in oaiRecordParser.ts (pure, offline-testable —
  // PLAN 7.3/7.4); this adapter routes its logging into ztoolkit.
  private parserLog: ParserLog = (message, level) => {
    ztoolkit.log(message, level);
  };

  /**
   * Checks if a record matches the given query terms (local filtering).
   * Case-insensitive, checks for substring and word presence.
   */
  public record_matches_query(
    record: BiblioRecord,
    query: Record<string, string>,
  ): boolean {
    // If query is empty, all records match
    if (Object.keys(query).length === 0) {
      return true;
    }

    for (const [field, term] of Object.entries(query)) {
      if (!term) continue; // Skip empty search terms

      const termLower = term.toLowerCase().trim();
      if (!termLower) continue; // Skip whitespace-only terms

      const termWords = termLower.split(/\s+/).filter(Boolean); // Split into words

      let matchFoundInField = false;

      // --- Check Specific Fields ---
      if (field.toLowerCase() === "title" && record.title) {
        const fieldTextLower = record.title.toLowerCase();
        if (
          fieldTextLower.includes(termLower) ||
          termWords.every((word) => fieldTextLower.includes(word))
        ) {
          matchFoundInField = true;
        }
      } else if (field.toLowerCase() === "author") {
        const namesToCheck = [
          ...(record.authors || []),
          ...(record.editors || []),
          ...(record.translators || []),
          ...(record.contributors || []).map((c) => c.name), // Check contributor names too
        ];
        for (const name of namesToCheck) {
          const nameLower = name.toLowerCase();
          if (
            nameLower.includes(termLower) ||
            termWords.every((word) => nameLower.includes(word))
          ) {
            matchFoundInField = true;
            break;
          }
        }
      } else if (field.toLowerCase() === "isbn" && record.isbn) {
        const recordValue = record.isbn.replace(/[^0-9X]/gi, "");
        const termValue = term.replace(/[^0-9X]/gi, "");
        if (recordValue.includes(termValue)) {
          matchFoundInField = true;
        }
      } else if (field.toLowerCase() === "issn" && record.issn) {
        const recordValue = record.issn.replace(/[^0-9X-]/gi, ""); // Keep hyphen for ISSN
        const termValue = term.replace(/[^0-9X-]/gi, "");
        if (recordValue.includes(termValue)) {
          matchFoundInField = true;
        }
      } else if (field.toLowerCase() === "year" && record.year) {
        if (record.year === term.trim()) {
          // Exact match for year
          matchFoundInField = true;
        }
      } else if (field.toLowerCase() === "subject" && record.subjects) {
        for (const subject of record.subjects) {
          const subjectLower = subject.toLowerCase();
          if (
            subjectLower.includes(termLower) ||
            termWords.every((word) => subjectLower.includes(word))
          ) {
            matchFoundInField = true;
            break;
          }
        }
      }
      // --- ADDED: All Fields Filter ---
      else if (field.toLowerCase() === "allfields") {
        // Check title, authors, editors, translators, contributors, abstract, subjects, publisher, series, journal
        const searchableText = [
          record.title,
          ...(record.authors || []),
          ...(record.editors || []),
          ...(record.translators || []),
          ...(record.contributors || []).map((c) => c.name),
          record.abstract,
          ...(record.subjects || []),
          record.publisher_name,
          record.series,
          record.journal_title,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(); // Join all text fields

        if (
          searchableText.includes(termLower) ||
          termWords.every((word) => searchableText.includes(word))
        ) {
          matchFoundInField = true;
        }
      }
      // --- END: All Fields Filter ---

      // If the specific field was checked and no match was found, the record doesn't match the query
      if (!matchFoundInField) {
        return false;
      }
    }

    // If we iterated through all query terms and found a match for each, the record matches
    return true;
  }

  /**
   * Check for errors in OAI-PMH response XML.
   */
  private checkForErrors(doc: Document): string | null {
    // Query for 'error' element, handling potential namespaces
    const errorElement = doc.querySelector("error, *|error");
    if (errorElement) {
      const code = errorElement.getAttribute("code") || "unknownCode";
      const message = errorElement.textContent?.trim() || "Unknown OAI error";
      // Return combined code and message
      return `(${code}) ${message}`;
    }
    // No <error> element found
    return null;
  }
} // End of OAIClient class
