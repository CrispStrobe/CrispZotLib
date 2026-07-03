// src/modules/librarySearch/oaiClient.ts
// OAI-PMH protocol client implementation - Fixed version

import { BiblioRecord } from "./models";
import { fetchWithTimeout, readXml } from "./httpUtils";
import { extractIsbn, extractIssn } from "./recordUtils";

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

      // Extract records from this page
      const records: BiblioRecord[] = [];
      // Query for 'record' elements directly under 'ListRecords'
      const recordElements = xmlDoc.querySelectorAll(
        "ListRecords > record, *|ListRecords > *|record",
      );

      recordElements.forEach((recordElement: Element) => {
        // Skip deleted records
        const header = recordElement.querySelector("header, *|header");
        if (header?.getAttribute("status") !== "deleted") {
          // Use the passed metadataPrefix for parsing consistency
          const record = this.process_record_element(
            recordElement,
            metadataPrefix,
          );
          if (record) {
            records.push(record);
          }
        }
      });

      // Extract the next resumption token
      const nextTokenElement = xmlDoc.querySelector(
        "resumptionToken, *|resumptionToken",
      );
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
      const recordElement = xmlDoc.querySelector(
        "GetRecord > record, *|GetRecord > *|record",
      );
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
      const record = this.process_record_element(recordElement, prefixToUse);
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

  /**
   * Process a record XML element into a BiblioRecord.
   * Assumes the input is the <record> element.
   */
  private process_record_element(
    recordElement: Element,
    metadataPrefix: string,
  ): BiblioRecord | null {
    const logPrefix = "[OAIClient.process_record_element]";
    try {
      // Extract header information (optional, but good for context)
      const header = recordElement.querySelector("header, *|header");
      const identifierElement = header?.querySelector(
        "identifier, *|identifier",
      );
      const identifier = identifierElement?.textContent?.trim() || "unknown";

      // Check if record is deleted (should ideally be skipped before calling this)
      if (header?.getAttribute("status") === "deleted") {
        console.warn(
          `${logPrefix} Processing a deleted record: ${identifier}. Returning minimal info.`,
        );
        ztoolkit.log(
          `${logPrefix} Skipping deleted record ${identifier}.`,
          "warn",
        );
        // Deleted records must not be imported as items.
        return null;
      }

      // Extract metadata element
      const metadataElement = recordElement.querySelector(
        "metadata, *|metadata",
      );
      if (!metadataElement) {
        console.warn(
          `${logPrefix} Record ${identifier} has no <metadata> element. Cannot parse.`,
        );
        ztoolkit.log(
          `${logPrefix} Record ${identifier} has no <metadata> element.`,
          "warn",
        );
        return null; // no metadata -> nothing importable
      }

      // --- Determine the actual metadata format within the <metadata> tag ---
      // The actual metadata is usually the *first child* of the <metadata> element.
      const actualMetadataRoot = metadataElement.firstElementChild;
      if (!actualMetadataRoot) {
        console.warn(
          `${logPrefix} Record ${identifier} has an empty <metadata> element. Cannot parse.`,
        );
        ztoolkit.log(
          `${logPrefix} Record ${identifier} has empty <metadata> element.`,
          "warn",
        );
        return null; // empty metadata -> nothing importable
      }

      // Determine parser based on the requested metadataPrefix
      // We parse based on what was *requested*, assuming the server complied.
      let parsedRecord: BiblioRecord | null = null;
      const prefixToUse = metadataPrefix || this.defaultMetadataPrefix;

      console.log(
        `${logPrefix} Parsing record ${identifier} using requested prefix: ${prefixToUse}`,
      );
      ztoolkit.log(
        `${logPrefix} Parsing record ${identifier} using prefix: ${prefixToUse}`,
      );

      // --- Select Parser ---
      // Add more cases for other prefixes if needed (e.g., marcxml, mods)
      if (prefixToUse === "oai_dc" || prefixToUse === "dc") {
        // Pass the actualMetadataRoot (e.g., the <oai_dc:dc> element) to the parser
        parsedRecord = this.parse_dublin_core(actualMetadataRoot, identifier);
      }
      // Add MARCXML parsing if implemented
      // else if (prefixToUse === 'marcxml' || prefixToUse === 'marc21') {
      //    parsedRecord = this.parse_marcxml(actualMetadataRoot, identifier);
      // }
      // Add MODS parsing if implemented
      // else if (prefixToUse === 'mods') {
      //    parsedRecord = this.parse_mods(actualMetadataRoot, identifier);
      // }
      else {
        // Generic parsing for unknown/unsupported formats
        console.warn(
          `${logPrefix} No specific parser for prefix '${prefixToUse}'. Using generic fallback for record ${identifier}.`,
        );
        ztoolkit.log(
          `${logPrefix} No specific parser for '${prefixToUse}'. Using generic fallback.`,
          "warn",
        );
        parsedRecord = this.parse_generic(actualMetadataRoot, identifier);
      }

      // Add raw metadata string if parsing was successful
      if (parsedRecord) {
        try {
          // Serialize the <metadata> element content, not the wrapper
          parsedRecord.raw_data = new XMLSerializer().serializeToString(
            actualMetadataRoot,
          );
          parsedRecord.schema = prefixToUse; // Store the schema used
        } catch (e) {
          console.error(
            `${logPrefix} Error serializing raw XML for ${identifier}:`,
            e,
          );
          ztoolkit.log(
            `${logPrefix} Error serializing raw XML for ${identifier}:`,
            "error",
          );
          parsedRecord.raw_data = "Error serializing raw data";
        }
      }

      return parsedRecord;
    } catch (e: any) {
      console.error(
        `${logPrefix} Error processing record element: ${e.message}`,
      );
      ztoolkit.log(
        `${logPrefix} Error processing record element: ${e.message}`,
        "error",
      );
      return null; // a parse error must not surface as an importable junk item
    }
  }

  /**
   * Parse Dublin Core metadata.
   * Assumes the input is the actual DC element (e.g., <oai_dc:dc> or <dc>).
   */
  private parse_dublin_core(
    dcElement: Element,
    identifier: string,
  ): BiblioRecord | null {
    const logPrefix = "[OAIClient.parse_dublin_core]";
    if (!dcElement) {
      console.warn(`${logPrefix} Received null dcElement for ${identifier}.`);
      ztoolkit.log(
        `${logPrefix} Received null dcElement for ${identifier}.`,
        "warn",
      );
      return null;
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
      subjects: [],
    };

    // Helper to query DC elements, handling potential namespaces
    const queryDC = (tagName: string): NodeListOf<Element> => {
      // Try specific prefixes first, then generic tag name, then wildcard namespace
      return dcElement.querySelectorAll(
        `dc\\:${tagName}, oai_dc\\:${tagName}, ${tagName}, *|${tagName}`,
      );
    };

    // Extract title
    const titleElements = queryDC("title");
    if (titleElements.length > 0 && titleElements[0].textContent) {
      record.title = titleElements[0].textContent.trim();
      // Clean up title - remove author info like " / Author Name" at the end
      record.title = record.title.replace(/\s*\/\s*[^/]+$/, "").trim();
    } else {
      console.warn(`${logPrefix} No title found for ${identifier}.`);
      ztoolkit.log(`${logPrefix} No title found for ${identifier}.`, "warn");
    }

    // Track seen names to avoid duplicates across different fields (creator, contributor)
    const seenNames = new Set<string>();

    // --- Process dc:creator ---
    const creatorElements = queryDC("creator");
    creatorElements.forEach((creatorElem: Element) => {
      if (creatorElem.textContent) {
        const name = creatorElem.textContent.trim();
        if (!name) return;

        // Basic role detection (can be improved)
        let role = "author"; // Default
        let cleanName = name;

        // Simple check for bracketed roles (e.g., "[Editor]")
        const roleMatch = name.match(/\s*\[([^\]]+)\]$/);
        if (roleMatch) {
          const roleText = roleMatch[1].toLowerCase();
          cleanName = name.substring(0, roleMatch.index).trim(); // Name before the bracket
          if (
            roleText.includes("herausgeber") ||
            roleText.includes("hrsg") ||
            roleText.includes("editor") ||
            roleText.includes("ed.")
          ) {
            role = "editor";
          } else if (
            roleText.includes("übersetzer") ||
            roleText.includes("transl")
          ) {
            role = "translator";
          }
          // Add more role checks if needed
        }

        if (cleanName && !seenNames.has(cleanName)) {
          if (role === "editor") {
            record.editors.push(cleanName);
          } else if (role === "translator") {
            record.translators.push(cleanName);
          } else {
            record.authors.push(cleanName); // Assume author if not editor/translator
          }
          seenNames.add(cleanName);
        }
      }
    });

    // --- Process dc:contributor ---
    const contributorElements = queryDC("contributor");
    contributorElements.forEach((contribElem: Element) => {
      if (contribElem.textContent) {
        const name = contribElem.textContent.trim();
        if (!name) return;

        // Role detection similar to creator
        let role = "contributor"; // Default for this field
        let cleanName = name;
        const roleMatch = name.match(/\s*\[([^\]]+)\]$/);
        if (roleMatch) {
          const roleText = roleMatch[1].toLowerCase();
          cleanName = name.substring(0, roleMatch.index).trim();
          if (
            roleText.includes("herausgeber") ||
            roleText.includes("hrsg") ||
            roleText.includes("editor") ||
            roleText.includes("ed.")
          ) {
            role = "editor";
          } else if (
            roleText.includes("übersetzer") ||
            roleText.includes("transl")
          ) {
            role = "translator";
          }
          // If a specific role like 'illustrator' is found, keep 'contributor' but store role info
          else if (roleText) {
            role = roleText; // Use the specific role text
          }
        }
        // Also check for roles indicated by keywords without brackets
        else if (/\b(editor|ed\.|hrsg|hg\.)\b/i.test(name)) {
          role = "editor";
          // Basic cleaning for keyword roles
          cleanName = name.replace(/\b(editor|ed\.|hrsg|hg\.)\b/i, "").trim();
        } else if (/\b(translator|trans\.|übers)\b/i.test(name)) {
          role = "translator";
          cleanName = name
            .replace(/\b(translator|trans\.|übers)\b/i, "")
            .trim();
        }

        if (cleanName && !seenNames.has(cleanName)) {
          if (role === "editor") {
            record.editors.push(cleanName);
          } else if (role === "translator") {
            record.translators.push(cleanName);
          } else {
            // Add to contributors array with role info
            record.contributors.push({ name: cleanName, role: role });
          }
          seenNames.add(cleanName);
        }
      }
    });

    // Extract date/year
    const dateElements = queryDC("date");
    for (const dateElem of dateElements) {
      // Iterate through all date elements
      if (dateElem.textContent) {
        const dateText = dateElem.textContent.trim();
        // Prioritize YYYY format
        const yearMatchYYYY = dateText.match(/^\b(1\d{3}|2[01]\d{2})\b$/);
        if (yearMatchYYYY) {
          record.year = yearMatchYYYY[1];
          break; // Found precise year, stop looking
        }
        // Fallback: Extract year from longer date string if not already found
        if (!record.year) {
          const yearMatchAny = dateText.match(/\b(1\d{3}|2[01]\d{2})\b/);
          if (yearMatchAny) {
            record.year = yearMatchAny[1];
            // Don't break here, maybe a more precise YYYY exists later
          }
        }
      }
    }

    // Extract publisher and place
    const publisherElements = queryDC("publisher");
    if (publisherElements.length > 0 && publisherElements[0].textContent) {
      const publisherText = publisherElements[0].textContent.trim();
      // Split place and publisher if separated by " : " or sometimes just ":"
      const match = publisherText.match(/^([^:]+)\s*:\s*(.+)$/);
      if (match) {
        record.place_of_publication = match[1].trim();
        record.publisher_name = match[2].trim();
      } else {
        // Assume it's just the publisher name if no clear separator
        record.publisher_name = publisherText;
      }
    }

    // Extract format
    const formatElements = queryDC("format");
    if (formatElements.length > 0 && formatElements[0].textContent) {
      record.format = formatElements[0].textContent.trim();
    }

    // Extract language
    const languageElements = queryDC("language");
    if (languageElements.length > 0 && languageElements[0].textContent) {
      // Often language codes (e.g., 'ger'), sometimes full names
      record.language = languageElements[0].textContent.trim();
    }

    // Extract subjects
    const subjectElements = queryDC("subject");
    subjectElements.forEach((subjectElem: Element) => {
      if (subjectElem.textContent?.trim()) {
        record.subjects.push(subjectElem.textContent.trim());
      }
    });

    // Extract identifiers (ISBN, ISSN, URL, DOI)
    const identifierElements = queryDC("identifier");
    identifierElements.forEach((idElem: Element) => {
      if (idElem.textContent) {
        const idText = idElem.textContent.trim();
        const idTextLower = idText.toLowerCase();

        // Extract URL (most specific check first)
        if (idText.startsWith("http://") || idText.startsWith("https://")) {
          // Check if it's a DOI URL
          if (idTextLower.includes("doi.org/")) {
            const doiMatch = idText.match(
              /doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
            );
            if (doiMatch && !record.doi) record.doi = doiMatch[1];
          }
          // Add as a general URL if not already present
          if (!record.urls.includes(idText)) {
            record.urls.push(idText);
          }
        }
        // Extract ISBN (validated: correct length + checksum, rejects DOIs/URNs)
        else if (idTextLower.startsWith("isbn") || extractIsbn(idText)) {
          const isbn = extractIsbn(idText);
          if (isbn && !record.isbn) record.isbn = isbn;
        }
        // Extract ISSN (validated checksum, rejects date-like strings)
        else if (idTextLower.startsWith("issn") || extractIssn(idText)) {
          const issn = extractIssn(idText);
          if (issn && !record.issn) record.issn = issn;
        }
        // Extract DOI (if not a URL)
        else if (
          idTextLower.startsWith("doi:") ||
          idTextLower.startsWith("10.")
        ) {
          const doiMatch = idText.match(
            /(?:doi:)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
          );
          if (doiMatch && !record.doi) record.doi = doiMatch[1];
        }
      }
    });

    // Extract description/abstract
    const descriptionElements = queryDC("description");
    if (descriptionElements.length > 0 && descriptionElements[0].textContent) {
      record.abstract = descriptionElements[0].textContent.trim();
    }

    // Extract source info (might contain journal title, volume, issue, pages, or series)
    const sourceElements = queryDC("source");
    if (sourceElements.length > 0 && sourceElements[0].textContent) {
      const sourceText = sourceElements[0].textContent.trim();

      // Try to parse as journal citation first
      // Example: "Journal of Stuff, Vol. 10, No. 2 (2023), pp. 100-110"
      const journalMatch = sourceText.match(
        /^(.*?)(?:,\s*Vol\.?\s*(\d+))?(?:,\s*No\.?\s*(\d+))?(?:\s*\(([^)]+)\))?(?:,\s*pp?\.?\s*(\d+(?:-\d+)?))?$/i,
      );
      if (journalMatch) {
        const potentialJournalTitle = journalMatch[1]?.trim();
        const potentialVolume = journalMatch[2];
        const potentialIssue = journalMatch[3];
        const potentialYearInParens = journalMatch[4]; // Year might be here
        const potentialPages = journalMatch[5];

        // Heuristic: If it has volume or issue, likely a journal
        if (potentialVolume || potentialIssue) {
          record.journal_title = potentialJournalTitle;
          record.volume = potentialVolume;
          record.issue = potentialIssue;
          record.pages = potentialPages;
          // Use year from parens if main year field is missing
          if (!record.year && potentialYearInParens) {
            const yearMatchParens = potentialYearInParens.match(
              /\b(1\d{3}|2[01]\d{2})\b/,
            );
            if (yearMatchParens) record.year = yearMatchParens[1];
          }
        }
        // If it looks like "In: Book Title", treat as series/book title for chapter
        else if (potentialJournalTitle?.match(/^in:?\s/i)) {
          record.series = potentialJournalTitle.replace(/^in:?\s/i, "").trim();
          // Pages might still be relevant for book chapter
          record.pages = potentialPages;
        }
        // Otherwise, store as series as a fallback
        else if (!record.series) {
          record.series = sourceText;
        }
      }
      // Fallback if no complex pattern matched
      else if (!record.series && !record.journal_title) {
        record.series = sourceText;
      }
    }

    // --- Refine Document Type ---
    // Use extracted fields to make a better guess
    if (record.journal_title && (record.volume || record.issue)) {
      record.document_type = "Journal Article";
    } else if (record.issn && !record.isbn) {
      // ISSN strongly suggests a Journal/Serial
      record.document_type = "Journal";
    } else if (record.series && record.pages && !record.journal_title) {
      // Series + pages suggests Book Chapter
      record.document_type = "Book Chapter";
    } else if (record.isbn) {
      // ISBN suggests a Book
      record.document_type = "Book";
    } else if (record.format) {
      // Use DC format as fallback
      const formatLower = record.format.toLowerCase();
      if (formatLower.includes("article"))
        record.document_type = "Journal Article";
      else if (formatLower.includes("book")) record.document_type = "Book";
      else if (formatLower.includes("thesis")) record.document_type = "Thesis";
      else if (formatLower.includes("report")) record.document_type = "Report";
      else record.document_type = record.format; // Use original format string
    } else {
      record.document_type = "Unknown"; // Default if no clues
    }
    // Ensure format field is consistent if possible
    if (record.document_type && !record.format) {
      record.format = record.document_type;
    }

    return record;
  }

  /**
   * Parse generic metadata (fallback for unknown formats).
   * Assumes the input is the root element of the specific metadata format (e.g., <mods>).
   */
  private parse_generic(
    metadataRootElement: Element,
    identifier: string,
  ): BiblioRecord | null {
    const logPrefix = "[OAIClient.parse_generic]";
    if (!metadataRootElement) {
      console.warn(
        `${logPrefix} Received null metadataRootElement for ${identifier}.`,
      );
      ztoolkit.log(
        `${logPrefix} Received null metadataRootElement for ${identifier}.`,
        "warn",
      );
      return null;
    }

    // Initialize record
    const record: BiblioRecord = {
      id: identifier,
      title: `Record ${identifier}`, // Default title
      authors: [],
      editors: [],
      translators: [],
      contributors: [],
      urls: [],
      subjects: [],
    };

    // --- Try common element names ---
    // Title
    const titleElements = metadataRootElement.querySelectorAll(
      "title, Title, titleInfo > title, dc\\:title, dcterms\\:title",
    );
    if (titleElements.length > 0 && titleElements[0].textContent) {
      record.title = titleElements[0].textContent.trim();
    }

    // Author/Creator
    const creatorElements = metadataRootElement.querySelectorAll(
      "creator, author, namePart, dc\\:creator, dcterms\\:creator",
    );
    creatorElements.forEach((el: Element) => {
      if (el.textContent?.trim()) {
        // Basic check: avoid adding duplicates if possible
        const name = el.textContent.trim();
        if (!record.authors.includes(name)) {
          record.authors.push(name);
        }
      }
    });

    // Date/Year
    const dateElements = metadataRootElement.querySelectorAll(
      "date, year, dateIssued, dc\\:date, dcterms\\:date, dcterms\\:issued",
    );
    if (dateElements.length > 0 && dateElements[0].textContent) {
      const dateText = dateElements[0].textContent.trim();
      const yearMatch = dateText.match(/\b(1\d{3}|2[01]\d{2})\b/);
      if (yearMatch) {
        record.year = yearMatch[1];
      }
    }

    // Publisher
    const publisherElements = metadataRootElement.querySelectorAll(
      "publisher, dc\\:publisher, dcterms\\:publisher",
    );
    if (publisherElements.length > 0 && publisherElements[0].textContent) {
      record.publisher_name = publisherElements[0].textContent.trim();
    }

    // Subjects
    const subjectElements = metadataRootElement.querySelectorAll(
      "subject, topic, keyword, dc\\:subject, dcterms\\:subject",
    );
    subjectElements.forEach((el: Element) => {
      if (el.textContent?.trim()) {
        const subject = el.textContent.trim();
        if (!record.subjects.includes(subject)) {
          record.subjects.push(subject);
        }
      }
    });

    // Identifiers (URL, ISBN, ISSN, DOI)
    const identifierElements = metadataRootElement.querySelectorAll(
      "identifier, dc\\:identifier, dcterms\\:identifier",
    );
    identifierElements.forEach((el: Element) => {
      if (el.textContent?.trim()) {
        const idText = el.textContent.trim();
        const idTextLower = idText.toLowerCase();
        const typeAttr = el.getAttribute("type")?.toLowerCase();

        if (idText.startsWith("http")) {
          if (!record.urls.includes(idText)) record.urls.push(idText);
        } else if (typeAttr === "isbn" || idTextLower.startsWith("isbn")) {
          const isbn = extractIsbn(idText);
          if (isbn && !record.isbn) record.isbn = isbn;
        } else if (typeAttr === "issn" || idTextLower.startsWith("issn")) {
          const issn = extractIssn(idText);
          if (issn && !record.issn) record.issn = issn;
        } else if (
          typeAttr === "doi" ||
          idTextLower.startsWith("doi:") ||
          idTextLower.startsWith("10.")
        ) {
          const doiMatch = idText.match(
            /(?:doi:)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
          );
          if (doiMatch && !record.doi) record.doi = doiMatch[1];
        }
      }
    });
    // Also check specific URL elements
    const urlElements = metadataRootElement.querySelectorAll(
      "url, link, relatedLink",
    );
    urlElements.forEach((el: Element) => {
      if (el.textContent?.trim() && el.textContent.trim().startsWith("http")) {
        const url = el.textContent.trim();
        if (!record.urls.includes(url)) record.urls.push(url);
      } else if (el.getAttribute("href")?.startsWith("http")) {
        const url = el.getAttribute("href")!;
        if (!record.urls.includes(url)) record.urls.push(url);
      }
    });

    // Abstract/Description
    const abstractElements = metadataRootElement.querySelectorAll(
      "abstract, description, note, dc\\:description, dcterms\\:abstract",
    );
    if (abstractElements.length > 0 && abstractElements[0].textContent) {
      record.abstract = abstractElements[0].textContent.trim();
    }

    // Language
    const languageElements = metadataRootElement.querySelectorAll(
      "language, languageTerm, dc\\:language, dcterms\\:language",
    );
    if (languageElements.length > 0 && languageElements[0].textContent) {
      record.language = languageElements[0].textContent.trim();
    }

    // Format/Type
    const formatElements = metadataRootElement.querySelectorAll(
      "format, type, genre, dc\\:format, dc\\:type, dcterms\\:type",
    );
    if (formatElements.length > 0 && formatElements[0].textContent) {
      record.format = formatElements[0].textContent.trim();
      record.document_type = record.format; // Use format as document type guess
    }

    // Add raw data (optional, for debugging)
    // try {
    //   record.raw_data = new XMLSerializer().serializeToString(metadataRootElement);
    // } catch (e) {
    //   console.error(`${logPrefix} Error serializing raw XML for ${identifier}:`, e);
    // }

    return record;
  }

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
