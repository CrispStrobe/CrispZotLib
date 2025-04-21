// src/modules/librarySearch/integration.ts
// Updated to use pure TypeScript search implementation

import { BiblioRecord } from './models';
import { openSearchDialog } from './searchDialog';
import { SearchService } from './searchService';
import { getString } from "../../utils/locale";

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
  static async executeSearch(params: {
    protocol: string;
    endpoint: string;
    title?: string;
    author?: string;
    isbn?: string;
    maxRecords?: number;
  }): Promise<[boolean, BiblioRecord[]]> {
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
  static async openResultsDialog(results: BiblioRecord[]): Promise<void> {
    if (!results || results.length === 0) {
      console.error("No results to display");
      return;
    }
    
    // Create dialog data
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
        // Make sure we clear any dialog references
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
      }
    };

    // Function to generate HTML content for each result
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

    // Create the dialog helper
    const dialogHelper = new ztoolkit.Dialog(rows, 1)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("results-dialog-title") }
      })
      .addCell(1, 0, {
        tag: "div",
        properties: { innerHTML: `Found ${results.length} results. Select items to import:` }
      });

    // Add results
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
      .addButton(getString("results-dialog-import-selected"), "import", {
        callback: async (e) => {
          // Get selected results
          const selectedResults = dialogData.selectedResults.map((index: number) => results[index]);

          if (selectedResults.length === 0) {
            if (dialogHelper.window) {
              dialogHelper.window.alert(getString("results-dialog-no-selection"));
            }
            return;
          }

          try {
            await LibrarySearchIntegration.importToZotero(selectedResults);
            if (dialogHelper.window) {
              dialogHelper.window.alert(getString("results-dialog-import-success"));
              
              // Clear reference before closing
              if (addon.data.dialog === dialogHelper) {
                addon.data.dialog = undefined;
              }
              
              dialogHelper.window.close();
            }
          } catch (error: any) {
            if (dialogHelper.window) {
              dialogHelper.window.alert(getString("results-dialog-import-error") + ": " + error?.message);
            }
          }
        },
        noClose: true
      })
      .addButton(getString("results-dialog-import-all"), "importAll", {
        callback: async (e) => {
          try {
            // Use 'results' instead of 'selectedResults'
            await LibrarySearchIntegration.importToZotero(results);
            if (dialogHelper.window) {
              dialogHelper.window.alert(getString("results-dialog-import-success"));
              dialogHelper.window.close();
            }
          } catch (error: any) {
            if (dialogHelper.window) {
              dialogHelper.window.alert(getString("results-dialog-import-error") + ": " + error?.message);
            }
          }
        },
        noClose: true
      })
      .addButton(getString("results-dialog-cancel"), "cancel")
      .setDialogData(dialogData);
  
    // Open the dialog
    dialogHelper.open(getString("results-dialog-title"));
    addon.data.dialog = dialogHelper;
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