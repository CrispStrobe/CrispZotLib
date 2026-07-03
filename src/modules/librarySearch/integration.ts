// src/modules/librarySearch/integration.ts
// Updated layout for results dialog

import { BiblioRecord } from './models';
import { mapRecordToItemType, parseCreatorName } from './formatters';
import { openSearchDialog } from './searchDialog';
import { createStyledDialog } from '../../utils/dialogUtils'; 
import { SearchService } from './searchService';
import { getString } from "../../utils/locale";
import { config } from "../../../package.json";

// Define a type for the search parameters needed for pagination
export type SearchParams = {
  protocol: string;
  endpoint: string;
  // OAI Harvesting Params
  set?: string;
  metadataPrefix?: string;
  from?: string;
  until?:string;
  // SRU Schema
  schema?: string;
  // Local Filtering Params (used by SRU query builder and OAI local filter)
  title?: string;
  author?: string;
  isbn?: string;
  allFieldsTerm?: string;
  // Pagination & Limit
  maxRecords: number;
  startRecord?: number; // Primarily for SRU/IxTheo page calculation
  resumptionToken?: string; // For OAI pagination
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
   * Open a dialog to display search results with improved layout
   */
  static async openResultsDialog(
    results: BiblioRecord[],
    totalRecords: number = results.length,
    searchParams: SearchParams // Pass original search parameters
  ): Promise<void> {
    if (!results || results.length === 0) {
      ztoolkit.log("No results to display");
      const win = Zotero.getMainWindow();
      win?.alert(getString("search-dialog-no-results"));
      return;
    }

    // --- LAYOUT CHANGE: Simplify grid, use CSS Flexbox more ---
    // Use fewer rows, 1 column. Layout managed more by CSS within cells.
    const dialogHelper = createStyledDialog(5, 1); // Header, Results, Pagination, Spacer, Buttons (approx)

    const dialogData: ResultsDialogData = {
      searchResults: results,
      selectedResults: [],
      totalRecords: totalRecords,
      currentStartRecord: searchParams.startRecord || 1,
      searchParams: searchParams,
      isLoading: false,
      loadCallback: (window: Window) => {
        console.log("Results dialog opened");
        if (window.document && window.document.body) {
            window.document.body.classList.add('librarysearch-dialog');
            // Add class to body for overall dialog styling if needed
            window.document.body.style.display = 'flex';
            window.document.body.style.flexDirection = 'column';
            window.document.body.style.height = '100%';
        }
        // Initial update of status/buttons
        updatePaginationControls(window.document, dialogData);
      },
      unloadCallback: () => {
        console.log("Results dialog closed");
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
      }
    };

    // Function to generate HTML content for each result (remains the same)
    const generateResultHTML = (result: BiblioRecord, index: number, currentDialogData: ResultsDialogData): any => {
        const title = result.title || "Untitled";
        const authors = result.authors?.join(", ") || "Unknown";
        const year = result.year || "";
        const publisher = result.publisher_name || "";

        return {
            tag: "div", namespace: "html", attributes: { class: "result-item", "data-index": index.toString() },
            styles: { marginBottom: '10px', padding: '10px', border: '1px solid var(--ls-border-color)', borderRadius: '4px' }, // Add some spacing/border
            children: [
                {
                    tag: "div", namespace: "html", styles: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" },
                    children: [
                        { tag: "h3", namespace: "html", styles: { margin: "0", flexGrow: 1, marginRight: '10px' }, properties: { innerHTML: title } }, // Allow title to grow
                        {
                            tag: "input", namespace: "html", attributes: { type: "checkbox", "data-index": index.toString() },
                            listeners: [{
                                type: "change", listener: (e: Event) => {
                                    const checkbox = e.target as HTMLInputElement;
                                    const itemIndex = parseInt(checkbox.getAttribute("data-index") || "0");
                                    if (checkbox.checked) { if (!currentDialogData.selectedResults.includes(itemIndex)) { currentDialogData.selectedResults.push(itemIndex); } }
                                    else { currentDialogData.selectedResults = currentDialogData.selectedResults.filter((idx: number) => idx !== itemIndex); }
                                    ztoolkit.log(`Selected indices: ${currentDialogData.selectedResults.join(', ')}`);
                                }
                            }]
                        }
                    ]
                },
                { tag: "div", namespace: "html", properties: { innerHTML: `<strong>Authors:</strong> ${authors}` }, styles: { fontSize: '0.9em', marginBottom: '3px'} },
                { tag: "div", namespace: "html", properties: { innerHTML: `<strong>Year:</strong> ${year}` }, styles: { fontSize: '0.9em', marginBottom: '3px'} },
                { tag: "div", namespace: "html", properties: { innerHTML: `<strong>Publisher:</strong> ${publisher}` }, styles: { fontSize: '0.9em'} }
            ]
        };
    };

    const rowsPerPage = searchParams.maxRecords;

    // --- Define Dialog Structure using addCell ---

    // Row 0: Header
    dialogHelper.addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: getString("results-dialog-title") },
      // styles: { gridColumn: "1 / span 1" } // Not needed for 1 column
    });

    // Row 1: Results Container (Allow it to grow)
    const resultsContainerSpec = {
      tag: "div", namespace: "html", id: "results-container", attributes: { class: "results-container" },
      styles: {
        // gridColumn: "1 / span 1", // Not needed
        flexGrow: 1, // Allow this container to take up available vertical space
        overflowY: "auto",
        border: '1px solid var(--ls-border-color)', // Add border for clarity
        padding: '5px',
        margin: '10px 0' // Add vertical margin
      },
      children: results.map((result, index) => generateResultHTML(result, index, dialogData))
    };
    dialogHelper.addCell(1, 0, resultsContainerSpec);

    // Row 2: Pagination Controls Area
    dialogHelper.addCell(2, 0, {
        tag: "div", namespace: "html", id: "pagination-controls",
        styles: {
            // gridColumn: "1 / span 1", // Not needed
            display: 'flex',
            justifyContent: 'space-between', // Space out buttons and status
            alignItems: 'center',
            padding: '10px 0', // Add padding
            borderTop: '1px solid var(--ls-border-color)', // Separator line
            marginTop: '10px'
        },
        children: [
            // Previous Button (defined inline)
            {
                tag: "button", id: "prev-button", properties: { innerHTML: "< Previous" },
                listeners: [{
                    type: "click", listener: async () => {
                        if (dialogData.isLoading) return;
                        const newStartRecord = dialogData.currentStartRecord - dialogData.searchParams.maxRecords;
                        if (newStartRecord >= 1) {
                            await fetchAndDisplayPage(newStartRecord, dialogData, dialogHelper.window.document);
                        }
                    }
                }]
            },
            // Status Label (centered)
            {
                tag: "div", id: "pagination-status",
                properties: { innerHTML: `Showing results ${dialogData.currentStartRecord}-${Math.min(dialogData.currentStartRecord + rowsPerPage - 1, dialogData.totalRecords)} of ${dialogData.totalRecords}` },
                styles: { textAlign: "center", flexGrow: 1, margin: '0 10px' } // Allow status to grow and add margin
            },
            // Next Button (defined inline)
            {
                tag: "button", id: "next-button", properties: { innerHTML: "Next >" },
                listeners: [{
                    type: "click", listener: async () => {
                        if (dialogData.isLoading) return;
                        const newStartRecord = dialogData.currentStartRecord + dialogData.searchParams.maxRecords;
                        if (newStartRecord <= dialogData.totalRecords) {
                            await fetchAndDisplayPage(newStartRecord, dialogData, dialogHelper.window.document);
                        }
                    }
                }]
            }
        ]
    });

    // Row 3: Main Action Buttons (Import/Cancel) - Use addButton
    // These will be moved to the final button row by createStyledDialog override
    dialogHelper.addButton(getString("results-dialog-import-selected"), "import", {
        callback: async () => {
            const selectedItems = dialogData.selectedResults.map(idx => dialogData.searchResults[idx]);
            if (selectedItems.length === 0) { dialogHelper.window?.alert(getString("results-dialog-no-selection")); return; }
            try {
                const count = await LibrarySearchIntegration.importToZotero(selectedItems);
                dialogHelper.window?.alert(`Successfully imported ${count} items`);
                dialogHelper.window?.close();
            } catch (error) { dialogHelper.window?.alert(`Error importing items: ${error}`); }
        }, noClose: true
    });
    dialogHelper.addButton(getString("results-dialog-import-all"), "importAll", {
        callback: async () => {
            try {
                const count = await LibrarySearchIntegration.importToZotero(dialogData.searchResults);
                dialogHelper.window?.alert(`Successfully imported ${count} items`);
                dialogHelper.window?.close();
            } catch (error) { dialogHelper.window?.alert(`Error importing items: ${error}`); }
        }, noClose: true
    });
    dialogHelper.addButton(getString("results-dialog-cancel"), "cancel", {});

    // --- End Dialog Structure ---

    dialogHelper.setDialogData(dialogData);

    const dialogOptions = { width: 800, height: 600 }; // Keep dimensions
    dialogHelper.open(getString("results-dialog-title"), dialogOptions);
    addon.data.dialog = dialogHelper; // Store reference

    // --- Helper function for pagination (remains mostly the same) ---
    async function fetchAndDisplayPage(
      startRecord: number,
      dialogData: ResultsDialogData,
      doc: Document // Pass the document context
    ): Promise<void> {
        dialogData.isLoading = true;
        updatePaginationControls(doc, dialogData, "Loading..."); // Update status/buttons

        try {
            const params = { ...dialogData.searchParams, startRecord: startRecord };
            const [success, newResults, totalRecords] = await LibrarySearchIntegration.executeSearch(params);

            if (success && newResults) {
                dialogData.searchResults = newResults;
                dialogData.currentStartRecord = startRecord;
                dialogData.totalRecords = totalRecords;
                dialogData.selectedResults = []; // Clear selection

                const resultsContainer = doc.getElementById("results-container");
                if (resultsContainer) {
                    while (resultsContainer.firstChild) { resultsContainer.removeChild(resultsContainer.firstChild); }
                    const resultElements = newResults.map((res, idx) => generateResultHTML(res, idx, dialogData));
                    resultElements.forEach(spec => {
                        const elem = ztoolkit.UI.createElement(doc, spec.tag, spec);
                        resultsContainer.appendChild(elem);
                    });
                    resultsContainer.scrollTop = 0; // Scroll to top of results
                }
            } else {
                const statusEl = doc.getElementById("pagination-status");
                if (statusEl) statusEl.textContent = "Error loading results.";
            }
        } catch (error) {
            console.error("Error fetching page:", error);
            const statusEl = doc.getElementById("pagination-status");
            if (statusEl) statusEl.textContent = "Error loading results.";
        } finally {
            dialogData.isLoading = false;
            updatePaginationControls(doc, dialogData); // Update status/buttons
        }
    }
  }

  // --- importToZotero function remains the same ---
  static async importToZotero(records: BiblioRecord[]): Promise<number> {
        if (!records || records.length === 0) {
            console.error("No records to import");
            return 0;
        }

        console.log(`Importing ${records.length} records to Zotero`);

        // Convert to Zotero-compatible format
        const items = records.map(record => {
            // Determine item type — document_type wins; fall back to heuristics.
            const itemType = mapRecordToItemType(record);

            // Format creators (corporate/mononym names kept single-field).
            const creators: any[] = [];
            (record.authors || []).forEach(author => {
                creators.push({ creatorType: "author", ...parseCreatorName(author) });
            });
            (record.editors || []).forEach(editor => {
                creators.push({ creatorType: "editor", ...parseCreatorName(editor) });
            });
            (record.translators || []).forEach(translator => {
                creators.push({ creatorType: "translator", ...parseCreatorName(translator) });
            });

            // Create base Zotero item
            const item: any = {
                itemType, title: record.title, _creatorsData: creators, // Store raw creator data temporarily
                date: record.year, publisher: record.publisher_name, place: record.place_of_publication,
                ISBN: record.isbn, ISSN: record.issn, language: record.language,
                url: record.urls && record.urls.length > 0 ? record.urls[0] : "",
                abstractNote: record.abstract, DOI: record.doi,
                tags: record.subjects ? record.subjects.map(subject => ({ tag: subject })) : []
            };

            // Add itemType-specific fields
            if (itemType === "journalArticle") { item.publicationTitle = record.journal_title; item.volume = record.volume; item.issue = record.issue; item.pages = record.pages; }
            else if (itemType === "bookSection") { item.bookTitle = record.series; item.pages = record.pages; }
            else if (itemType === "book") { item.series = record.series; item.edition = record.edition; }

            // Clean up undefined/null/empty values
            Object.keys(item).forEach(key => { if (item[key] === undefined || item[key] === null || item[key] === "") { delete item[key]; } });
            return item;
        });

        // Use Zotero API to create items
        try {
            const activePane = Zotero.getActiveZoteroPane();
            if (!activePane) { throw new Error("Could not get active Zotero pane."); }
            const collection = activePane.getSelectedCollection();
            const libraryID = collection ? collection.libraryID : (activePane.getSelectedLibraryID() || Zotero.Libraries.userLibraryID);

            const createdItems = [];
            const failures: string[] = [];
            for (const itemData of items) {
                // Per-item isolation: one bad record must not abort the whole batch.
                try {
                    const newItem = new Zotero.Item(itemData.itemType);
                    newItem.libraryID = libraryID;

                    for (const field in itemData) {
                        if (field === 'itemType' || field === '_creatorsData' || field === 'tags' || field === 'libraryID') continue;
                        if (!itemData[field]) continue;
                        // Per-field isolation: a field that is invalid for this item
                        // type (e.g. ISBN on a journalArticle) is skipped, not fatal.
                        try {
                            newItem.setField(field, itemData[field]);
                        } catch (fieldErr) {
                            Zotero.debug(`[LibrarySearch] Skipping field "${field}" for itemType "${itemData.itemType}": ${fieldErr}`);
                        }
                    }

                    if (itemData._creatorsData && itemData._creatorsData.length > 0) {
                        itemData._creatorsData.forEach((creator: any, i: number) => {
                            const creatorTypeID = Zotero.CreatorTypes.getID(creator.creatorType);
                            const validCreatorType = creatorTypeID !== 0 ? creator.creatorType : 'author';
                            // Single-field (corporate/mononym) vs two-field personal name.
                            const zc: any =
                                creator.fieldMode === 1 || creator.name
                                    ? { creatorType: validCreatorType, name: creator.name, fieldMode: 1 }
                                    : { creatorType: validCreatorType, firstName: creator.firstName, lastName: creator.lastName };
                            newItem.setCreator(i, zc);
                        });
                    }

                    if (itemData.tags && itemData.tags.length > 0) { itemData.tags.forEach((tag: any) => newItem.addTag(tag.tag)); }
                    if (collection) { newItem.setCollections([collection.id]); }

                    await newItem.saveTx();
                    createdItems.push(newItem);
                } catch (itemErr: any) {
                    const label = itemData.title || itemData.DOI || itemData.ISBN || '(untitled)';
                    failures.push(`${label}: ${itemErr?.message || itemErr}`);
                    console.error(`Error importing item "${label}":`, itemErr);
                }
            }

            console.log(`Imported ${createdItems.length}/${items.length} items` + (failures.length ? `, ${failures.length} failed` : ''));
            if (failures.length > 0) {
                ztoolkit.log(`[LibrarySearch] Import failures:\n${failures.join('\n')}`, 'warn');
            }
            if (createdItems.length > 0 && activePane) { activePane.selectItems(createdItems.map(item => item.id as number)); }
            return createdItems.length;
        } catch (error) {
            console.error("Error importing items:", error);
            throw error;
        }
    }

} // End LibrarySearchIntegration class

// --- updatePaginationControls helper function remains the same ---
function updatePaginationControls(doc: Document, dialogData: ResultsDialogData, statusText?: string): void {
  const prevButton = doc.getElementById("prev-button") as HTMLButtonElement | null;
  const nextButton = doc.getElementById("next-button") as HTMLButtonElement | null;
  const statusLabel = doc.getElementById("pagination-status");

  if (statusLabel) {
    if (statusText) {
      statusLabel.textContent = statusText;
    } else {
      const endRecord = Math.min(dialogData.currentStartRecord + dialogData.searchParams.maxRecords - 1, dialogData.totalRecords);
      statusLabel.textContent = `Showing ${dialogData.currentStartRecord}-${endRecord} of ${dialogData.totalRecords}`; // Simplified text
    }
  }

  if (prevButton) {
    prevButton.disabled = dialogData.isLoading || dialogData.currentStartRecord <= 1;
  }
  if (nextButton) {
    // Corrected logic: disable if the *next* page would start beyond the total
    nextButton.disabled = dialogData.isLoading || (dialogData.currentStartRecord + dialogData.searchParams.maxRecords > dialogData.totalRecords);
  }
}