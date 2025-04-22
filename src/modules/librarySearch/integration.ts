// src/modules/librarySearch/integration.ts
// Updated to use pure TypeScript search implementation

import { BiblioRecord } from './models';
import { openSearchDialog, createStyledDialog } from './searchDialog';
import { SearchService } from './searchService';
import { getString } from "../../utils/locale";
import { config } from "../../../package.json";


// Define a type for the search parameters needed for pagination
export type SearchParams = {
  protocol: string;
  endpoint: string;
  title?: string;
  author?: string;
  isbn?: string;
  schema?: string; // Include schema if implementing schema selection
  maxRecords: number;
  startRecord?: number; // Optional, for pagination
};

// Define an interface for results dialog data
export interface ResultsDialogData {
  searchResults: BiblioRecord[];
  selectedResults: number[];
  totalRecords: number;
  currentStartRecord: number;
  searchParams: SearchParams; // Store original search parameters
  isLoading: boolean; // To prevent multiple clicks
  loadCallback?: (window: Window) => void;
  unloadCallback?: () => void;
}

/**
 * LibrarySearchIntegration class - Handles integration with Zotero
 */
export class LibrarySearchIntegration {
  /**
   * Initialize the integration
   */
  static init(): void {
    console.log("Library Search Integration initialized");
  }

  /**
   * Execute a search with the given parameters
   */
  static async executeSearch(params: SearchParams): Promise<[boolean, BiblioRecord[], number]> {
    try {
      // Use our new SearchService
      return await SearchService.executeSearch(params);
    } catch (error) {
      console.error('Error executing search:', error);
      throw error;
    }
  }

  /**
   * Open the search dialog
   */
  static async openSearchDialog(): Promise<void> {
    await openSearchDialog();
  }

  /**
   * Open a dialog to display search results
   */
  static async openResultsDialog(
    results: BiblioRecord[],
    totalRecords: number = results.length,
    searchParams: SearchParams // Pass original search parameters
  ): Promise<void> {
    if (!results || results.length === 0) {
      ztoolkit.log("No results to display");
      // Optionally show an alert here
      const win = Zotero.getMainWindow();
      win?.alert(getString("search-dialog-no-results"));
      return;
    }

    // Define dialogHelper FIRST
    const dialogHelper = createStyledDialog(12, 4); // Increased columns for controls

    // Create dialog data with type
    const dialogData: ResultsDialogData = {
      searchResults: results,
      selectedResults: [],
      totalRecords: totalRecords,
      currentStartRecord: 1, // Initial page starts at 1
      searchParams: searchParams,
      isLoading: false,
      loadCallback: (window: Window) => {
        console.log("Results dialog opened");
        if (window.document && window.document.body) {
          window.document.body.classList.add('librarysearch-dialog');
        }
        // Initial update of status/buttons
        // Using window.document here
        updatePaginationControls(window.document, dialogData);
      },
      unloadCallback: () => {
        console.log("Results dialog closed");
        // Make sure we clear any dialog references
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
      }
    };

    // Function to generate HTML content for each result
    const generateResultHTML = (result: BiblioRecord, index: number, currentDialogData: ResultsDialogData): any => { // Renamed parameter
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
            namespace: "html", // Add namespace
            styles: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px"
            },
            children: [
              {
                tag: "h3",
                namespace: "html", // Add namespace
                styles: { margin: "0" },
                properties: { innerHTML: title }
              },
              {
                tag: "input",
                namespace: "html", // Add namespace
                attributes: { 
                  type: "checkbox",
                  "data-index": index.toString()
                },
                listeners: [{
                  type: "change",
                  listener: (e: Event) => {
                    const checkbox = e.target as HTMLInputElement;
                    // Use itemIndex consistently
                    const itemIndex = parseInt(checkbox.getAttribute("data-index") || "0");
    
                    // Now dialogData is available via the parameter
                    if (checkbox.checked) {
                      if (!currentDialogData.selectedResults.includes(itemIndex)) {
                        currentDialogData.selectedResults.push(itemIndex);
                      }
                    } else {
                      // Explicitly type idx in the filter
                      currentDialogData.selectedResults = currentDialogData.selectedResults.filter(
                        (idx: number) => idx !== itemIndex
                      );
                    }
                    ztoolkit.log(`Selected indices: ${currentDialogData.selectedResults.join(', ')}`);
                  }
                }]
              }
            ]
          },
          {
            tag: "div",
            namespace: "html", // Add namespace
            properties: { innerHTML: `<strong>Authors:</strong> ${authors}` }
          },
          {
            tag: "div",
            namespace: "html", // Add namespace
            properties: { innerHTML: `<strong>Year:</strong> ${year}` }
          },
          {
            tag: "div",
            namespace: "html", // Add namespace
            properties: { innerHTML: `<strong>Publisher:</strong> ${publisher}` }
          }
        ]
      };
    };

    // Calculate rows per page for pagination display
    const rowsPerPage = searchParams.maxRecords;

    // Header
    dialogHelper.addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("results-dialog-title") },
      styles: { gridColumn: "1 / span 4" } // Span all columns
    });

    // Status Label
    dialogHelper.addCell(1, 0, {
      tag: "div",
      id: "pagination-status", // Add ID for easy update
      properties: { innerHTML: `Showing results ${dialogData.currentStartRecord}-${Math.min(dialogData.currentStartRecord + rowsPerPage - 1, dialogData.totalRecords)} of ${dialogData.totalRecords}` },
      styles: { gridColumn: "1 / span 4", textAlign: "center", margin: "5px 0" }
    });

    // Results Container
    const resultsContainerSpec = {
      tag: "div",
      namespace: "html",
      id: "results-container", // Add ID for easy update
      attributes: { class: "results-container" },
      styles: {
        gridColumn: "1 / span 4", // Span all columns
        maxHeight: "400px",
        overflowY: "auto",
        marginTop: "10px",
        marginBottom: "10px"
      },
      children: results.map((result, index) => generateResultHTML(result, index, dialogData)) // Pass dialogData here
    };
    dialogHelper.addCell(2, 0, resultsContainerSpec);

    // --- Pagination Buttons ---
    // Previous Button
    dialogHelper.addCell(3, 0, { // Place in first column of a new row
      tag: "button",
      id: "prev-button",
      properties: { innerHTML: "< Previous" },
      listeners: [{
        type: "click",
        listener: async (e: Event) => {
          if (dialogData.isLoading) return;
          const newStartRecord = dialogData.currentStartRecord - dialogData.searchParams.maxRecords;
          if (newStartRecord >= 1) {
            await fetchAndDisplayPage(newStartRecord, dialogData, dialogHelper.window.document);
          }
        }
      }]
    });

    // Next Button
    dialogHelper.addCell(3, 3, { // Place in last column
      tag: "button",
      id: "next-button",
      properties: { innerHTML: "Next >" },
      styles: { justifySelf: "end" }, // Align button to the right
      listeners: [{
        type: "click",
        listener: async (e: Event) => {
          if (dialogData.isLoading) return;
          const newStartRecord = dialogData.currentStartRecord + dialogData.searchParams.maxRecords;
          if (newStartRecord <= dialogData.totalRecords) {
            // Pass the document object from dialogHelper.window
            await fetchAndDisplayPage(newStartRecord, dialogData, dialogHelper.window.document);
          }
        }
      }]
    });
    // --- End Pagination Buttons ---

    // --- Import/Cancel Buttons (adjust row index) ---
    dialogHelper
      .addButton(getString("results-dialog-import-selected"), "import", { 
        callback: async () => {
          // Get selected items
          const selectedItems = dialogData.selectedResults.map(idx => dialogData.searchResults[idx]);
          if (selectedItems.length === 0) {
            dialogHelper.window?.alert(getString("results-dialog-no-selection"));
            return;
          }
          
          try {
            const count = await LibrarySearchIntegration.importToZotero(selectedItems);
            dialogHelper.window?.alert(`Successfully imported ${count} items`);
            dialogHelper.window?.close();
          } catch (error) {
            dialogHelper.window?.alert(`Error importing items: ${error}`);
          }
        }, 
        noClose: true 
      }, 4, 0) // Row 4, Col 0
      .addButton(getString("results-dialog-import-all"), "importAll", { 
        callback: async () => {
          try {
            const count = await LibrarySearchIntegration.importToZotero(dialogData.searchResults);
            dialogHelper.window?.alert(`Successfully imported ${count} items`);
            dialogHelper.window?.close();
          } catch (error) {
            dialogHelper.window?.alert(`Error importing items: ${error}`);
          }
        }, 
        noClose: true 
      }, 4, 1) // Row 4, Col 1
      .addButton(getString("results-dialog-cancel"), "cancel", {}, 4, 3); // Row 4, Col 3 (align right)
    // --- End Import/Cancel Buttons ---

    dialogHelper.setDialogData(dialogData);

    const dialogOptions = { width: 800, height: 600 };
    dialogHelper.open(getString("results-dialog-title"), dialogOptions);
    addon.data.dialog = dialogHelper;

    // --- Helper function for pagination ---
    async function fetchAndDisplayPage(
      startRecord: number,
      dialogData: ResultsDialogData,
      doc: Document
    ): Promise<void> {
      // Update UI: Disable buttons, show loading
      dialogData.isLoading = true;
      updatePaginationControls(doc, dialogData, "Loading...");

      try {
        const params = {
          ...dialogData.searchParams,
          startRecord: startRecord // Override startRecord
        };

        // Fetch new page data
        const [success, newResults, totalRecords] = await LibrarySearchIntegration.executeSearch(params);

        if (success && newResults) {
          // Update dialog data
          dialogData.searchResults = newResults;
          dialogData.currentStartRecord = startRecord;
          dialogData.totalRecords = totalRecords; // Update total just in case
          dialogData.selectedResults = []; // Clear selection on page change

          // Update results display
          const resultsContainer = doc.getElementById("results-container");
          if (resultsContainer) {
            // Clear existing results
            while (resultsContainer.firstChild) {
              resultsContainer.removeChild(resultsContainer.firstChild);
            }
            // Add new results
            const resultElements = newResults.map((res, idx) => generateResultHTML(res, idx, dialogData));
            resultElements.forEach(spec => {
              const elem = ztoolkit.UI.createElement(doc, spec.tag, spec);
              resultsContainer.appendChild(elem);
            });
          }
        } else {
          // Handle error fetching new page
          const statusEl = doc.getElementById("pagination-status");
          if (statusEl) {
            statusEl.textContent = "Error loading results.";
          }
        }
      } catch (error) {
        console.error("Error fetching page:", error);
        const statusEl = doc.getElementById("pagination-status");
        if (statusEl) {
          statusEl.textContent = "Error loading results.";
        }
      } finally {
        dialogData.isLoading = false;
        // Update UI: Re-enable buttons, update status
        updatePaginationControls(doc, dialogData);
      }
    }
  }

  /**
   * Import search results into Zotero
   */
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
}

// Helper function to update pagination controls state
function updatePaginationControls(doc: Document, dialogData: ResultsDialogData, statusText?: string): void {
  const prevButton = doc.getElementById("prev-button") as HTMLButtonElement | null;
  const nextButton = doc.getElementById("next-button") as HTMLButtonElement | null;
  const statusLabel = doc.getElementById("pagination-status");

  if (statusLabel) {
    if (statusText) {
      statusLabel.textContent = statusText;
    } else {
      const endRecord = Math.min(dialogData.currentStartRecord + dialogData.searchParams.maxRecords - 1, dialogData.totalRecords);
      statusLabel.textContent = `Showing results ${dialogData.currentStartRecord}-${endRecord} of ${dialogData.totalRecords}`;
    }
  }

  if (prevButton) {
    prevButton.disabled = dialogData.isLoading || dialogData.currentStartRecord <= 1;
  }
  if (nextButton) {
    nextButton.disabled = dialogData.isLoading || (dialogData.currentStartRecord + dialogData.searchParams.maxRecords > dialogData.totalRecords);
  }
}