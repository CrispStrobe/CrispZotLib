// integration.ts - Integration with Zotero

import { BiblioRecord } from './models';
import { SRU_ENDPOINTS, OAI_ENDPOINTS } from './endpoints';
import { SRUClient, escapeQueryString } from './sruClient';
import { OAIClient } from './oaiClient';
import { formatRecord, formatRecordBibtex, formatRecordRis } from './formatters';
import { getString } from "../../utils/locale";

// LibrarySearchIntegration class - Main integration with Zotero
export class LibrarySearchIntegration {
  private static sruClient: SRUClient | null = null;
  private static oaiClient: OAIClient | null = null;

  // Methods:
  // 1. init - Initialize the integration
  static init(): void {
    console.log("Library Search Integration initialized");
  }

  // 2. buildSruQuery - Build a suitable query string for the specified SRU endpoint
  static buildSruQuery(
    params: {
          title?: string;
          author?: string;
          isbn?: string;
          issn?: string;
          year?: string;
          advanced?: string | Record<string, string>;
        },
        endpointId: string
      ): string {
        // Get endpoint info
        const endpointInfo = SRU_ENDPOINTS[endpointId];
        const examples = endpointInfo?.examples || {};
        
        // For BNF endpoint, ensure we're using the correct schema
        if (endpointId === 'bnf' && !params.advanced) {
          // Override default schema for BNF
        }
        
        // Handle ISBN search
        if (params.isbn) {
          if (examples.isbn) {
            // Extract the format from the example
            const example = examples.isbn;
            if (example.includes('=')) {
              const parts = example.split('=');
              const prefix = parts[0];
              // Check if the value is quoted in the example
              if (parts.length > 1 && (parts[1].startsWith('"') || parts[1].startsWith("'"))) {
                return `${prefix}="${params.isbn}"`;
              } else {
                return `${prefix}=${params.isbn}`;
              }
            }
          }
          
          // Default formats if no example is available
          if (endpointId === 'dnb') {
            return `ISBN=${params.isbn}`;
          } else if (endpointId === 'bnf') {
            return `bib.isbn any "${params.isbn}"`;
          } else {
            return `isbn=${params.isbn}`;
          }
        }
        
        // Handle ISSN search
        if (params.issn) {
          if (examples.issn) {
            // Extract the format from the example
            const example = examples.issn;
            if (example.includes('=')) {
              const parts = example.split('=');
              const prefix = parts[0];
              // Check if the value is quoted in the example
              if (parts.length > 1 && (parts[1].startsWith('"') || parts[1].startsWith("'"))) {
                return `${prefix}="${params.issn}"`;
              } else {
                return `${prefix}=${params.issn}`;
              }
            }
          }
          
          // Default formats if no example is available
          if (endpointId === 'dnb' || endpointId === 'zdb') {
            return `ISS=${params.issn}`;
          } else if (endpointId === 'bnf') {
            return `bib.issn any "${params.issn}"`;
          } else {
            return `issn=${params.issn}`;
          }
        }
        
        // Handle title search
        if (params.title) {
          if (examples.title) {
            // Extract the format from the example
            const example = examples.title;
            if (example.includes('=')) {
              const parts = example.split('=');
              const prefix = parts[0];
              // Check if the value is quoted in the example
              if (parts.length > 1 && (parts[1].startsWith('"') || parts[1].startsWith("'"))) {
                return `${prefix}="${params.title}"`;
              } else {
                return `${prefix}=${params.title}`;
              }
            } else {
              // Handle "all" syntax (BNF)
              if (example.includes(' all ')) {
                const parts = example.split(' all ');
                const prefix = parts[0];
                return `${prefix} all "${params.title}"`;
              } else if (example.includes(' any ')) {
                const parts = example.split(' any ');
                const prefix = parts[0];
                return `${prefix} any "${params.title}"`;
              }
            }
          }
          
          // Default formats if no example is available
          if (endpointId === 'dnb') {
            return `TIT=${params.title}`;
          } else if (endpointId === 'bnf') {
            return `bib.title any "${params.title}"`;
          } else {
            return `title="${params.title}"`;
          }
        }
        
        // Handle author search
        if (params.author) {
          if (examples.author) {
            // Extract the format from the example
            const example = examples.author;
            if (example.includes('=')) {
              const parts = example.split('=');
              const prefix = parts[0];
              // Check if the value is quoted in the example
              if (parts.length > 1 && (parts[1].startsWith('"') || parts[1].startsWith("'"))) {
                return `${prefix}="${params.author}"`;
              } else {
                return `${prefix}=${params.author}`;
              }
            } else {
              // Handle "all" syntax (BNF)
              if (example.includes(' all ')) {
                const parts = example.split(' all ');
                const prefix = parts[0];
                return `${prefix} all "${params.author}"`;
              } else if (example.includes(' any ')) {
                const parts = example.split(' any ');
                const prefix = parts[0];
                return `${prefix} any "${params.author}"`;
              }
            }
          }
          
          // Default formats if no example is available
          if (endpointId === 'dnb') {
            return `PER=${params.author}`;
          } else if (endpointId === 'bnf') {
            return `bib.author any "${params.author}"`;
          } else {
            return `author="${params.author}"`;
          }
        }
        
        // Handle year search
        if (params.year) {
          if (endpointId === 'dnb') {
            return `JHR=${params.year}`;
          } else if (endpointId === 'bnf') {
            return `bib.date any "${params.year}"`;
          } else {
            return `date=${params.year}`;
          }
        }
        
        // Advanced query handling
        if (params.advanced) {
          if (typeof params.advanced === 'string') {
            // If it's already a string, use it directly
            return params.advanced;
          } else if (typeof params.advanced === 'object') {
            // If it's a dictionary, format according to endpoint
            if (examples.advanced && typeof examples.advanced === 'object') {
              // Use the format from the example
              const advExample = examples.advanced;
              const advKeys = Object.keys(advExample);
              
              // Map query keys to endpoint-specific keys if possible
              const queryParts: string[] = [];
              for (const [k, v] of Object.entries(params.advanced)) {
                // Try to find a matching key in the example
                let endpointKey: string | null = null;
                for (const exKey of advKeys) {
                  if (k.toLowerCase().includes(exKey.toLowerCase()) || 
                    exKey.toLowerCase().includes(k.toLowerCase())) {
                    endpointKey = exKey;
                    break;
                  }
                }
                
                if (endpointKey) {
                  queryParts.push(`${endpointKey}=${v}`);
                } else {
                  // Use the key as-is if no match found
                  queryParts.push(`${k}=${v}`);
                }
              }
              
              return queryParts.join(" AND ");
            } else {
              // Default format
              if (endpointId === 'dnb') {
                return Object.entries(params.advanced).map(([k, v]) => `${k}=${v}`).join(" AND ");
              } else if (endpointId === 'bnf') {
                return Object.entries(params.advanced).map(([k, v]) => `bib.${k} any "${v}"`).join(" and ");
              } else {
                return Object.entries(params.advanced).map(([k, v]) => `${k}="${v}"`).join(" and ");
              }
            }
          }
        }
        
        // If no specific search criteria were provided
        console.error("No search criteria specified");
        return "";
  }

  // 3. searchSruEndpoint - Search an SRU endpoint
  static async searchSruEndpoint(
    params: {
          endpoint: string;
          title?: string;
          author?: string;
          isbn?: string;
          issn?: string;
          year?: string;
          advanced?: string | Record<string, string>;
          schema?: string;
          maxRecords?: number;
          startRecord?: number;
          timeout?: number;
        }
      ): Promise<[boolean, BiblioRecord[]]> {
        const endpointId = params.endpoint;
        
        if (!(endpointId in SRU_ENDPOINTS)) {
          console.error(`Unknown SRU endpoint: ${endpointId}`);
          return [false, []];
        }
        
        // Get endpoint info
        const endpointInfo = SRU_ENDPOINTS[endpointId];
        console.log(`Using ${endpointInfo.name} (${endpointId}) via SRU protocol`);
        
        // Build query
        const query = this.buildSruQuery(params, endpointId);
        if (!query) {
          console.error("Failed to build SRU query");
          return [false, []];
        }
        
        // Create SRU client if needed
        if (!this.sruClient || this.sruClient.baseUrl !== endpointInfo.url) {
          this.sruClient = new SRUClient(
            endpointInfo.url,
            endpointInfo.defaultSchema,
            endpointInfo.version || '1.1',
            params.timeout || 30000
          );
        }
        
        console.log(`Searching with SRU query: ${query}`);
        
        try {
          // Execute search
          const [total, records] = await this.sruClient.search(
            query,
            params.schema || endpointInfo.defaultSchema,
            params.maxRecords || 10,
            params.startRecord || 1
          );
          
          if (total === 0 || records.length === 0) {
            // Check for BNF error with schema
            if (endpointId === 'bnf' && params.schema === 'marcxchange') {
              console.warn("The BNF catalog reported an issue with the marcxchange schema. Try using a different schema, such as 'dublincore'.");
            } else {
              console.warn("No results found");
            }
            return [false, []];
          }
          
          console.log(`Found ${total} results, showing ${records.length}`);
          
          return [true, records];
        } catch (e) {
          console.error(`Error performing SRU search: ${e}`);
          return [false, []];
        }
  }

  // 4. searchOaiEndpoint - Search an OAI-PMH endpoint
  static async searchOaiEndpoint(
    params: {
          endpoint: string;
          title?: string;
          author?: string;
          isbn?: string;
          issn?: string;
          year?: string;
          metadataPrefix?: string;
          set?: string;
          fromDate?: string;
          untilDate?: string;
          maxRecords?: number;
          timeout?: number;
        }
      ): Promise<[boolean, BiblioRecord[]]> {
        const endpointId = params.endpoint;
        
        if (!(endpointId in OAI_ENDPOINTS)) {
          console.error(`Unknown OAI-PMH endpoint: ${endpointId}`);
          return [false, []];
        }
        
        // Get endpoint info
        const endpointInfo = OAI_ENDPOINTS[endpointId];
        console.log(`Using ${endpointInfo.name} (${endpointId}) via OAI-PMH protocol`);
        
        // Create OAI client if needed
        if (!this.oaiClient || this.oaiClient.baseUrl !== endpointInfo.url) {
          this.oaiClient = new OAIClient(
            endpointInfo.url,
            endpointInfo.defaultMetadataPrefix || 'oai_dc',
            params.timeout || 30000
          );
        }
        
        // Prepare search query if applicable
        const searchQuery: Record<string, string> = {};
        if (params.title) {
          searchQuery.title = params.title;
        }
        if (params.author) {
          searchQuery.author = params.author;
        }
        if (params.isbn) {
          searchQuery.isbn = params.isbn;
        }
        if (params.issn) {
          searchQuery.issn = params.issn;
        }
        if (params.year) {
          searchQuery.year = params.year;
        }
        
        console.log(`Searching OAI-PMH endpoint with:`);
        console.log(`  Set: ${params.set || 'None'}`);
        console.log(`  From date: ${params.fromDate || 'None'}`);
        console.log(`  Until date: ${params.untilDate || 'None'}`);
        console.log(`  Metadata format: ${params.metadataPrefix || endpointInfo.defaultMetadataPrefix || 'oai_dc'}`);
        if (Object.keys(searchQuery).length > 0) {
          console.log(`  Search terms:`, searchQuery);
        }
        
        try {
          // Execute search
          const [total, records] = await this.oaiClient.search(
            searchQuery,
            params.metadataPrefix || endpointInfo.defaultMetadataPrefix,
            params.set,
            params.fromDate,
            params.untilDate,
            params.maxRecords || 10
          );
          
          if (total === 0 || records.length === 0) {
            console.warn("No results found");
            return [false, []];
          }
          
          console.log(`Found ${total} results, showing ${records.length}`);
          
          return [true, records];
        } catch (e) {
          console.error(`Error performing OAI-PMH search: ${e}`);
          return [false, []];
        }
  }

  // 5. executeSearch - Execute a library search with the provided parameters
  static async executeSearch(params: {
        protocol: string;
        endpoint: string;
        title?: string;
        author?: string;
        isbn?: string;
        issn?: string;
        advanced?: string | Record<string, string>;
        schema?: string;
        metadataPrefix?: string;
        set?: string;
        fromDate?: string;
        untilDate?: string;
        maxRecords?: number;
        startRecord?: number;
        timeout?: number;
        format?: string;
      }): Promise<[boolean, BiblioRecord[]]> {
        console.log("Executing library search with parameters:", params);
        
        switch (params.protocol.toLowerCase()) {
          case 'sru':
            return await this.searchSruEndpoint(params);
          
          case 'oai':
            return await this.searchOaiEndpoint(params);
          
          default:
            console.error(`Unsupported protocol: ${params.protocol}`);
            return [false, []];
        }
  }

  // 6. importToZotero - Import search results into Zotero
  static async importToZotero(records: BiblioRecord[]): Promise<number> {
    if (!records || records.length === 0) {
          console.error("No records to import");
          return 0;
        }
        
        console.log(`Importing ${records.length} records to Zotero`);
        
        // Convert to Zotero-compatible format
        const items = records.map(record => {
          // Determine item type
          let itemType = "book"; // Default
          if (record.journal_title || record.issn) {
            itemType = "journalArticle";
          } else if (record.document_type) {
            const docType = record.document_type.toLowerCase();
            if (docType.includes("article")) {
              itemType = "journalArticle";
            } else if (docType.includes("chapter")) {
              itemType = "bookSection";
            } else if (docType.includes("thesis")) {
              itemType = "thesis";
            } else if (docType.includes("conference")) {
              itemType = "conferencePaper";
            } else if (docType.includes("report")) {
              itemType = "report";
            }
          }
          
          // Format creators
          const creators: any[] = [];
          
          // Add authors
          if (record.authors && record.authors.length > 0) {
            for (const author of record.authors) {
              const creator: any = { creatorType: "author" };
              if (author.includes(',')) {
                const parts = author.split(',', 2);
                creator.lastName = parts[0].trim();
                creator.firstName = parts.length > 1 ? parts[1].trim() : "";
              } else {
                const parts = author.split(' ');
                if (parts.length > 1) {
                  creator.lastName = parts[parts.length - 1];
                  creator.firstName = parts.slice(0, parts.length - 1).join(' ');
                } else {
                  creator.lastName = author;
                  creator.firstName = "";
                }
              }
              creators.push(creator);
            }
          }
          
          // Add editors
          if (record.editors && record.editors.length > 0) {
            for (const editor of record.editors) {
              const creator: any = { creatorType: "editor" };
              if (editor.includes(',')) {
                const parts = editor.split(',', 2);
                creator.lastName = parts[0].trim();
                creator.firstName = parts.length > 1 ? parts[1].trim() : "";
              } else {
                const parts = editor.split(' ');
                if (parts.length > 1) {
                  creator.lastName = parts[parts.length - 1];
                  creator.firstName = parts.slice(0, parts.length - 1).join(' ');
                } else {
                  creator.lastName = editor;
                  creator.firstName = "";
                }
              }
              creators.push(creator);
            }
          }
          
          // Create base Zotero item
          const item: any = {
            itemType,
            title: record.title,
            creators,
            date: record.year,
            publisher: record.publisher_name,
            place: record.place_of_publication,
            ISBN: record.isbn,
            ISSN: record.issn,
            language: record.language,
            url: record.urls && record.urls.length > 0 ? record.urls[0] : "",
            abstractNote: record.abstract,
            DOI: record.doi,
            tags: record.subjects ? record.subjects.map(subject => ({ tag: subject })) : []
          };
          
          // Add itemType-specific fields
          if (itemType === "journalArticle") {
            item.publicationTitle = record.journal_title;
            item.volume = record.volume;
            item.issue = record.issue;
            item.pages = record.pages;
          } else if (itemType === "bookSection") {
            item.bookTitle = record.series;
            item.pages = record.pages;
          } else if (itemType === "book") {
            item.series = record.series;
            item.edition = record.edition;
          }
          
          // Clean up undefined/null/empty values
          Object.keys(item).forEach(key => {
            if (item[key] === undefined || item[key] === null || item[key] === "") {
              delete item[key];
            }
          });
          
          return item;
        });
        
        // Use Zotero API to create items
        // const Zotero = window.Zotero; // Access global Zotero object
        // Zotero is already available as a global
        
        try {
          // Get current library/collection
          const collection = Zotero.getActiveZoteroPane().getSelectedCollection();
          let libraryID;
          
          if (collection) {
            libraryID = collection.libraryID;
          } else {
            libraryID = Zotero.getActiveZoteroPane().getSelectedLibraryID();
          }
          
          // Create items
          const createdItems = [];
          
          for (const item of items) {
            // Create the item in the current library
            const newItem = new Zotero.Item(item.itemType);
            
            // Set fields
            for (const field in item) {
              if (field === 'itemType' || field === 'creators' || field === 'tags') {
                continue;
              }
              if (item[field]) {
                newItem.setField(field, item[field]);
              }
            }
            
            // Set creators
            if (item.creators && item.creators.length > 0) {
              for (let i = 0; i < item.creators.length; i++) {
                const creator = item.creators[i];
                newItem.setCreator(i, {
                  firstName: creator.firstName,
                  lastName: creator.lastName,
                  creatorType: creator.creatorType
                });
              }
            }
            
            // Set tags
            if (item.tags && item.tags.length > 0) {
              for (const tag of item.tags) {
                newItem.addTag(tag.tag);
              }
            }
            
            // Add to collection if one is selected
            if (collection) {
              newItem.setCollections([collection.id]);
            }
            
            // Save the item
            await newItem.saveTx();
            createdItems.push(newItem);
          }
        
        console.log(`Successfully imported ${createdItems.length} items`);
            
        // Select the items in the UI
        if (createdItems.length > 0) {
            Zotero.getActiveZoteroPane().selectItems(createdItems.map(item => item.id));
        }
    
        return createdItems.length;
      } catch (error) {
        console.error("Error importing items:", error);
        throw error;
      }
  }

  // 7. openResultsDialog - Create a results dialog to display and import search results
  static async openResultsDialog(results: BiblioRecord[]): Promise<void> {
    if (!results || results.length === 0) {
      console.error("No results to display");
      return;
      }
      
      // Use the Zotero Dialog helper from the TypeScript plugin
      const addon = _globalThis.addon;
      const dialogData: { [key: string]: any } = {
      searchResults: results,
      selectedResults: [],
      loadCallback: (window: Window) => {
        console.log("Results dialog opened");
        if (window.document && window.document.body) {
          window.document.body.classList.add('librarysearch-dialog');
        }
      },
      unloadCallback: () => {
        console.log("Results dialog closed");
        // Clear dialog references
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
      }
      };
      
      // Generate HTML content for each result
      const generateResultHTML = (result: BiblioRecord, index: number) => {
      const title = result.title || "Untitled";
      const authors = result.authors?.join(", ") || "Unknown";
      const year = result.year || "";
      const publisher = result.publisher_name || "";
      
      return {
        tag: "div",
        namespace: "html",
        attributes: {
          class: "result-item",
          "data-index": index.toString()
        },
        children: [
          {
            tag: "div",
            styles: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px"
            },
            children: [
              {
                tag: "h3",
                styles: { margin: "0" },
                properties: { innerHTML: title }
              },
              {
                tag: "input",
                attributes: {
                  type: "checkbox",
                  "data-index": index.toString()
                },
                listeners: [
                  {
                    type: "change",
                    listener: (e: Event) => {
                      const checkbox = e.target as HTMLInputElement;
                      const idx = parseInt(checkbox.getAttribute("data-index") || "0");
                      
                      if (checkbox.checked) {
                        if (!dialogData.selectedResults.includes(idx)) {
                          dialogData.selectedResults.push(idx);
                        }
                      } else {
                        const pos = dialogData.selectedResults.indexOf(idx);
                        if (pos >= 0) {
                          dialogData.selectedResults.splice(pos, 1);
                        }
                      }
                    }
                  }
                ]
              }
            ]
          },
          {
            tag: "div",
            properties: { innerHTML: `<strong>Authors:</strong> ${authors}` }
          },
          {
            tag: "div",
            properties: { innerHTML: `<strong>Year:</strong> ${year}` }
          },
          {
            tag: "div",
            properties: { innerHTML: `<strong>Publisher:</strong> ${publisher}` }
          }
        ]
      };
      };
      
      // Calculate dialog size based on number of results
      const rows = Math.min(results.length * 2 + 3, 20);
      
      // Create dialog helper using the plugin's Dialog class
      const ztoolkit = _globalThis.ztoolkit;
      
      const dialogHelper = new ztoolkit.Dialog(rows, 1)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: "Library Search Results" }
      })
      .addCell(1, 0, {
        tag: "div",
        properties: { innerHTML: `Found ${results.length} results. Select items to import:` }
      });
      
      // Add results container
      const resultsContainer = {
      tag: "div",
      namespace: "html",
      attributes: { 
        class: "results-container" 
      },
      styles: {
        maxHeight: "400px",
        overflowY: "auto",
        marginTop: "10px",
        marginBottom: "10px"
      },
      children: results.map((result, index) => generateResultHTML(result, index))
      };
      
      dialogHelper.addCell(2, 0, resultsContainer);
      
      // Add buttons
      dialogHelper
      .addButton("Import Selected", "import", {
        callback: async (e: Event) => {
          // Get selected results
          const selectedResults = dialogData.selectedResults.map((index: number) => results[index]);
          
          if (selectedResults.length === 0) {
            if (dialogHelper.window) {
              dialogHelper.window.alert("Please select at least one result to import");
            }
            return;
          }
          
          try {
            const imported = await LibrarySearchIntegration.importToZotero(selectedResults);
            if (dialogHelper.window) {
              dialogHelper.window.alert(`Successfully imported ${imported} items to Zotero`);
              
              // Clear reference before closing
              if (addon.data.dialog === dialogHelper) {
                addon.data.dialog = undefined;
              }
              
              dialogHelper.window.close();
            }
          } catch (error: any) {
            if (dialogHelper.window) {
              dialogHelper.window.alert("Error importing items: " + (error?.message || "Unknown error"));
            }
          }
        },
        noClose: true
      })
      .addButton("Import All", "importAll", {
        callback: async (e: Event) => {
          try {
            const imported = await LibrarySearchIntegration.importToZotero(results);
            if (dialogHelper.window) {
              dialogHelper.window.alert(`Successfully imported ${imported} items to Zotero`);
              dialogHelper.window.close();
            }
          } catch (error: any) {
            if (dialogHelper.window) {
              dialogHelper.window.alert("Error importing items: " + (error?.message || "Unknown error"));
            }
          }
        },
        noClose: true
      })
      .addButton("Cancel", "cancel")
      .setDialogData(dialogData);
      
      // Open the dialog
      dialogHelper.open("Library Search Results");
      }

  // 8. openSearchDialog - Create the main search dialog
  static async openSearchDialog(): Promise<void> {
    // Use the global addon object to access plugin functionality
    const addon = _globalThis.addon;
    // const addon = Zotero.__addonInstance__ || _globalThis.addon;

    // Get the existing dialog window if it exists
    if (addon.data.dialog?.window) {
    try {
      // Check if the window is still valid
      if (!addon.data.dialog.window.closed) {
        addon.data.dialog.window.focus();
        return;
      }
    } catch (e) {
      // Window reference is invalid, continue creating a new dialog
      console.log("Previous dialog reference was invalid, creating new one");
    }

    // Reset dialog reference
    addon.data.dialog = undefined;
    }

    // Create dialog data with default values
    interface LibrarySearchDialogData {
        protocol: string;
        endpoint: string;
        title: string;
        author: string;
        isbn: string;
        maxResults: number;
        searching: boolean;
        searchComplete: boolean;
        errorMessage: string;
        loadCallback?: () => void; 
        unloadCallback?: () => void; 
      }

    // Create dialog data with type
    const dialogData: LibrarySearchDialogData = {
    protocol: "sru",
    endpoint: "dnb", // Default endpoint
    title: "",
    author: "",
    isbn: "",
    maxResults: 10,
    searching: false,
    searchComplete: false,
    errorMessage: ""
    };

    // Setup callbacks
    dialogData.loadCallback = function(): void {
    if (dialogHelper.window) {
      // Manually trigger a change event on the protocol dropdown
      const protocolSelect = dialogHelper.window.document.getElementById("protocol-select") as HTMLSelectElement;
      if (protocolSelect) {
        const changeEvent = new Event("change");  
        
        try {
          protocolSelect.dispatchEvent(changeEvent);
        } catch (e) {
          // If dispatchEvent fails, manually call the change handler
          const selectedProtocol = protocolSelect.value;
          dialogData.protocol = selectedProtocol;
          
          // Update endpoint dropdown based on selected protocol
          updateEndpointDropdown(selectedProtocol, dialogHelper.window);
        }
      }
    }
    };

    dialogData.unloadCallback = function(): void {
    // Clear the dialog reference when it's closed
    addon.data.dialog = undefined;
    console.log("Dialog closed and reference cleared");
    };

    // Create the dialog helper
    const ztoolkit = _globalThis.ztoolkit;
    const dialogHelper = new ztoolkit.Dialog(12, 2)
    // Dialog header
    .addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("search-dialog-title") },
      styles: { gridColumn: "1 / span 2" }
    })
    .addCell(1, 0, {
      tag: "div",
      styles: { gridColumn: "1 / span 2" },
      properties: {
        innerHTML: "Search library catalogs directly from Zotero"
      }
    })

    // Search section
    .addCell(2, 0, {
      tag: "h3",
      properties: { innerHTML: "Search Parameters" },
      styles: { gridColumn: "1 / span 2", marginBottom: "5px", marginTop: "15px" }
    })

    // Protocol selection
    .addCell(3, 0, {
      tag: "label",
      namespace: "html",
      properties: {
        textContent: "Protocol",
      },
    })
    .addCell(3, 1, {
      tag: "select",
      namespace: "html",
      id: "protocol-select",
      styles: { width: "100%" },
      listeners: [{
        type: "change",
        listener: function(e: any) {
          const selectedProtocol = e.target.value;
          dialogData.protocol = selectedProtocol;
          
          // Update the endpoint dropdown based on the selected protocol
          if (dialogHelper.window) {
            updateEndpointDropdown(selectedProtocol, dialogHelper.window);
          }
        }
      }],
      children: [
        {
          tag: "option",
          properties: { value: "sru", innerHTML: "SRU" }
        },
        {
          tag: "option",
          properties: { value: "oai", innerHTML: "OAI-PMH" }
        }
      ]
    })

    // Endpoint selection
    .addCell(4, 0, {
      tag: "label",
      namespace: "html",
      properties: {
        textContent: "Endpoint",
      },
    })
    .addCell(4, 1, {
      tag: "div",
      id: "endpoint-cell",
      styles: { width: "100%" }
    })

    // Title
    .addCell(5, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "title" },
      properties: { innerHTML: "Title" },
    })
    .addCell(5, 1, {
      tag: "input",
      namespace: "html",
      id: "title",
      attributes: {
        type: "text",
        value: dialogData.title
      },
      styles: { width: "100%" },
      listeners: [
        {
          type: "input",
          listener: (e: Event) => {
            dialogData.title = (e.target as HTMLInputElement).value;
          }
        }
      ]
    })

    // Author
    .addCell(6, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "author" },
      properties: { innerHTML: "Author" },
    })
    .addCell(6, 1, {
      tag: "input",
      namespace: "html",
      id: "author",
      attributes: {
        type: "text",
        value: dialogData.author
      },
      styles: { width: "100%" },
      listeners: [
        {
          type: "input",
          listener: (e: Event) => {
            dialogData.author = (e.target as HTMLInputElement).value;
          }
        }
      ]
    })

    // ISBN
    .addCell(7, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "isbn" },
      properties: { innerHTML: "ISBN/ISSN" },
    })
    .addCell(7, 1, {
      tag: "input",
      namespace: "html",
      id: "isbn",
      attributes: {
        type: "text",
        value: dialogData.isbn
      },
      styles: { width: "100%" },
      listeners: [
        {
          type: "input",
          listener: (e: Event) => {
            dialogData.isbn = (e.target as HTMLInputElement).value;
          }
        }
      ]
    })

    // Max Results
    .addCell(8, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "maxResults" },
      properties: { innerHTML: "Max Results" },
    })
    .addCell(8, 1, {
      tag: "input",
      namespace: "html",
      id: "maxResults",
      attributes: {
        type: "number",
        min: "1",
        max: "100",
        value: dialogData.maxResults.toString()
      },
      styles: { width: "100px" },
      listeners: [
        {
          type: "input",
          listener: (e: Event) => {
            dialogData.maxResults = parseInt((e.target as HTMLInputElement).value, 10);
          }
        }
      ]
    })

    // Add buttons
    .addButton("Search", "search", {
      callback: async (e: Event) => {
        // Prevent multiple searches
        if (dialogData.searching) {
          return;
        }
        
        // Get the current values from UI elements
        if (dialogHelper.window) {
          const doc = dialogHelper.window.document;
          
          // Get protocol
          const protocolSelect = doc.getElementById('protocol-select') as HTMLSelectElement;
          if (protocolSelect) {
            dialogData.protocol = protocolSelect.value;
          }
          
          // Get endpoint
          const endpointSelect = doc.getElementById('endpoint-select') as HTMLSelectElement;
          if (endpointSelect) {
            dialogData.endpoint = endpointSelect.value;
          }
          
          // Get other fields
          const titleInput = doc.getElementById('title') as HTMLInputElement;
          if (titleInput) dialogData.title = titleInput.value;
          
          const authorInput = doc.getElementById('author') as HTMLInputElement;
          if (authorInput) dialogData.author = authorInput.value;
          
          const isbnInput = doc.getElementById('isbn') as HTMLInputElement;
          if (isbnInput) dialogData.isbn = isbnInput.value;
          
          const maxResultsInput = doc.getElementById('maxResults') as HTMLInputElement;
          if (maxResultsInput) dialogData.maxResults = parseInt(maxResultsInput.value, 10);
        }
        
        // Reset search state
        dialogData.searching = true;
        dialogData.searchComplete = false;
        dialogData.errorMessage = "";
        
        // Update UI to show searching state
        const searchButton = dialogHelper.window?.document?.querySelector("#search") as HTMLButtonElement | null;
        if (searchButton) {
          searchButton.disabled = true;
          searchButton.textContent = "Searching...";
        }
        
        try {
          console.log("Search parameters:", {
            protocol: dialogData.protocol,
            endpoint: dialogData.endpoint,
            title: dialogData.title,
            author: dialogData.author,
            isbn: dialogData.isbn,
            maxResults: dialogData.maxResults
          });
          
          const searchParams = {
            protocol: dialogData.protocol,
            endpoint: dialogData.endpoint,
            title: dialogData.title,
            author: dialogData.author,
            isbn: dialogData.isbn,
            maxRecords: dialogData.maxResults
          };
          
          // Run the search
          const [success, results] = await LibrarySearchIntegration.executeSearch(searchParams);
          
          // Open results dialog if we have results
          if (success && results && results.length > 0) {
            // Clear the search dialog reference before opening the results dialog
            const searchDialogRef = addon.data.dialog;
            addon.data.dialog = undefined;
            
            // Close the search dialog
            if (searchDialogRef && searchDialogRef.window && !searchDialogRef.window.closed) {
              searchDialogRef.window.close();
            }
            
            // Open results dialog
            await LibrarySearchIntegration.openResultsDialog(results);
          } else {
            dialogData.errorMessage = "No results found";
            if (dialogHelper.window) {
              dialogHelper.window.alert("No results found. Try modifying your search terms.");
            }
          }
        } catch (error: any) {
          console.error("Search error:", error);
          dialogData.errorMessage = error?.message || "Error performing search";
          
          if (dialogHelper.window) {
            dialogHelper.window.alert(dialogData.errorMessage);
          }
        } finally {
          // Reset search button
          dialogData.searching = false;
          if (searchButton) {
            searchButton.disabled = false;
            searchButton.textContent = "Search";
          }
        }
      },
      noClose: true
    })
    .addButton("Cancel", "cancel");

    // Set dialog data
    dialogHelper.setDialogData(dialogData);

    // Open the dialog and store reference
    dialogHelper.open("Library Search");
    addon.data.dialog = dialogHelper;

    /**
    * Updates the endpoint dropdown options based on the selected protocol
    */
    function updateEndpointDropdown(protocol: string, window: Window | null | undefined) {
    if (!window) return;

    try {
      const doc = window.document;
      const endpointCell = doc.getElementById("endpoint-cell");
      if (!endpointCell) {
        console.error("Could not find endpoint cell element");
        return;
      }
      
      // Clear existing content
      endpointCell.innerHTML = "";
      
      // Create new select element
      const endpointSelect = doc.createElement("select");
      endpointSelect.id = "endpoint-select";
      endpointSelect.style.width = "100%";
      
      // Define options for each protocol
      const optionMap: Record<string, string[]> = {
        "sru": Object.keys(SRU_ENDPOINTS),
        "oai": Object.keys(OAI_ENDPOINTS)
      };
      
      // Default values
      const defaultValues: Record<string, string> = {
        "sru": "dnb",
        "oai": "crossref"
      };
      
      // Get options for selected protocol
      const options = optionMap[protocol] || optionMap["sru"];
      const defaultValue = defaultValues[protocol] || "dnb";
      
      // Add options
      for (const option of options) {
        const optElement = doc.createElement("option");
        optElement.value = option;
        optElement.text = option;
        endpointSelect.appendChild(optElement);
      }
      
      // Set the default value
      endpointSelect.value = defaultValue;
      dialogData.endpoint = defaultValue;
      
      // Add change listener
      endpointSelect.addEventListener("change", function() {
        dialogData.endpoint = endpointSelect.value;
      });
      
      // Add to DOM
      endpointCell.appendChild(endpointSelect);
      
      console.log(`Updated endpoint dropdown with ${options.length} options, set to: ${defaultValue}`);
    } catch (error) {
      console.error(`Error updating endpoint dropdown: ${error}`);
    }
    }

  }
}

// Helper function to update endpoint dropdown
function updateEndpointDropdown(protocol: string, window: Window | null | undefined): void {
  // Implementation
}