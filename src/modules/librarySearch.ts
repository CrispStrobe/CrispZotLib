import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";

// Type declarations for Components interfaces
declare namespace Components {
  const classes: {
    [key: string]: {
      createInstance(interface: any): any;
    };
  };
  const interfaces: {
    nsIProcess: any;
    nsIFile: any;
    nsIPipe: any;
    nsIScriptableInputStream: any;
    nsIFilePicker: any;
  };
}

export class LibrarySearchModule {

  /**
   * Opens the search dialog to configure and run a library search
   */
  static async openSearchDialog() {
    // Get the existing dialog window if it exists
    if (addon.data.dialog?.window) {
      addon.data.dialog.window.focus();
      return;
    }

    // Get the Python path and script path from preferences
    const pythonPath = getPref("pythonPath") || "";
    const scriptPath = getPref("scriptPath") || "";

    // Create dialog data with default values
    const dialogData: { [key: string | number]: any } = {
      pythonPath: pythonPath,
      scriptPath: scriptPath,
      protocol: "sru",
      endpoint: "dnb",
      title: "",
      author: "",
      isbn: "",
      issn: "",
      year: "",
      maxResults: 10,
      loadCallback: () => {
        ztoolkit.log("Search dialog opened");
      },
      unloadCallback: () => {
        ztoolkit.log("Search dialog closed");
        addon.data.dialog = undefined;
      },
      searchResults: [],
      searching: false,
      searchComplete: false,
      errorMessage: "",
    };

    // Create the dialog helper
    const dialogHelper = new ztoolkit.Dialog(12, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("search-dialog-title") },
        styles: { gridColumn: "1 / span 2" }
      })
      .addCell(1, 0, {
        tag: "div",
        styles: { gridColumn: "1 / span 2" },
        properties: {
          innerHTML: getString("search-dialog-description")
        }
      })

      // Configuration section
      .addCell(2, 0, {
        tag: "h3",
        properties: { innerHTML: getString("search-dialog-config-section") },
        styles: { gridColumn: "1 / span 2", marginBottom: "5px", marginTop: "15px" }
      })

      // Python Path
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "pythonPath" },
        properties: { innerHTML: getString("search-dialog-python-path") },
      })
      .addCell(3, 1, {
        tag: "input",
        namespace: "html",
        id: "pythonPath",
        attributes: {
          type: "text",
          "data-bind": "pythonPath",
          "data-prop": "value"
        },
        styles: { width: "100%" },
      })

      // Script Path
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "scriptPath" },
        properties: { innerHTML: getString("search-dialog-script-path") },
      })
      .addCell(4, 1, {
        tag: "input",
        namespace: "html",
        id: "scriptPath",
        attributes: {
          type: "text",
          "data-bind": "scriptPath",
          "data-prop": "value"
        },
        styles: { width: "100%" },
      })

      // Search section
      .addCell(5, 0, {
        tag: "h3",
        properties: { innerHTML: getString("search-dialog-search-section") },
        styles: { gridColumn: "1 / span 2", marginBottom: "5px", marginTop: "15px" }
      })

      // Protocol
      .addCell(6, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "protocol" },
        properties: { innerHTML: getString("search-dialog-protocol") },
      })
      .addCell(6, 1, {
        tag: "select",
        namespace: "html",
        id: "protocol",
        attributes: {
          "data-bind": "protocol",
          "data-prop": "value"
        },
        children: [
          {
            tag: "option",
            attributes: { value: "sru" },
            properties: { innerHTML: "SRU" }
          },
          {
            tag: "option",
            attributes: { value: "oai" },
            properties: { innerHTML: "OAI-PMH" }
          },
          {
            tag: "option",
            attributes: { value: "ixtheo" },
            properties: { innerHTML: "IxTheo" }
          }
        ]
      })

      // Endpoint
      .addCell(7, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "endpoint" },
        properties: { innerHTML: getString("search-dialog-endpoint") },
      })
      .addCell(7, 1, {
        tag: "input",
        namespace: "html",
        id: "endpoint",
        attributes: {
          type: "text",
          "data-bind": "endpoint",
          "data-prop": "value"
        },
        styles: { width: "100%" },
      })

      // Search terms
      // Title
      .addCell(8, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "title" },
        properties: { innerHTML: getString("search-dialog-title-field") },
      })
      .addCell(8, 1, {
        tag: "input",
        namespace: "html",
        id: "title",
        attributes: {
          type: "text",
          "data-bind": "title",
          "data-prop": "value"
        },
        styles: { width: "100%" },
      })

      // Author
      .addCell(9, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "author" },
        properties: { innerHTML: getString("search-dialog-author") },
      })
      .addCell(9, 1, {
        tag: "input",
        namespace: "html",
        id: "author",
        attributes: {
          type: "text",
          "data-bind": "author",
          "data-prop": "value"
        },
        styles: { width: "100%" },
      })

      // ISBN
      .addCell(10, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "isbn" },
        properties: { innerHTML: getString("search-dialog-isbn") },
      })
      .addCell(10, 1, {
        tag: "input",
        namespace: "html",
        id: "isbn",
        attributes: {
          type: "text",
          "data-bind": "isbn",
          "data-prop": "value"
        },
        styles: { width: "100%" },
      })

      // Max Results
      .addCell(11, 0, {
        tag: "label",
        namespace: "html",
        attributes: { for: "maxResults" },
        properties: { innerHTML: getString("search-dialog-max-results") },
      })
      .addCell(11, 1, {
        tag: "input",
        namespace: "html",
        id: "maxResults",
        attributes: {
          type: "number",
          min: "1",
          max: "100",
          "data-bind": "maxResults",
          "data-prop": "value"
        },
        styles: { width: "100px" },
      })

      // Add buttons
      .addButton(getString("search-dialog-search-button"), "search", {
        callback: async (e) => {
          // Prevent multiple searches
          if (dialogData.searching) {
            return;
          }

          // Save the Python and script paths to preferences
          setPref("pythonPath", dialogData.pythonPath);
          setPref("scriptPath", dialogData.scriptPath);

          // Reset search state
          dialogData.searching = true;
          dialogData.searchComplete = false;
          dialogData.errorMessage = "";
          dialogData.searchResults = [];

          // Update UI to show searching state
          const searchButton = dialogHelper.window?.document?.querySelector("#search") as HTMLButtonElement | null;
          if (searchButton) {
            searchButton.disabled = true;
            searchButton.textContent = getString("search-dialog-searching");
          }

          // Run the search
          try {
            const searchParams = {
              pythonPath: dialogData.pythonPath,
              scriptPath: dialogData.scriptPath,
              protocol: dialogData.protocol,
              endpoint: dialogData.endpoint,
              title: dialogData.title,
              author: dialogData.author,
              isbn: dialogData.isbn,
              maxResults: dialogData.maxResults
            };

            const results = await LibrarySearchModule.runSearch(searchParams);

            // Store the results
            dialogData.searchResults = results;
            dialogData.searchComplete = true;

            // Open results dialog
            if (results && results.length > 0) {
              await LibrarySearchModule.openResultsDialog(results);
            } else {
              dialogData.errorMessage = getString("search-dialog-no-results");
            }
          } catch (error: any) {
            ztoolkit.log("Search error:", error);
            dialogData.errorMessage = error?.message || getString("search-dialog-error");
          } finally {
            // Reset search button
            dialogData.searching = false;
            if (searchButton) {
              searchButton.disabled = false;
              searchButton.textContent = getString("search-dialog-search-button");
            }

            // Show error message if any
            if (dialogData.errorMessage) {
              dialogHelper.window?.alert(dialogData.errorMessage);
            }
          }
        },
        noClose: true
      })
      .addButton(getString("search-dialog-cancel-button"), "cancel")
      .setDialogData(dialogData)
      .open(getString("search-dialog-title"));

    addon.data.dialog = dialogHelper;
  }

  /**
   * Runs a search using the library_search.py script
   */
  static async runSearch(searchParams: any): Promise<any[]> {
    const { pythonPath, scriptPath, protocol, endpoint, title, author, isbn, maxResults } = searchParams;

    // Validate inputs
    if (!pythonPath || !scriptPath) {
      throw new Error(getString("search-error-missing-paths"));
    }

    if (!endpoint) {
      throw new Error(getString("search-error-missing-endpoint"));
    }

    if (!title && !author && !isbn) {
      throw new Error(getString("search-error-missing-search-terms"));
    }

    // Build command arguments
    const args = [
      scriptPath,
      "--protocol", protocol,
      "--endpoint", endpoint,
      "--format", "json",
      "--max-records", maxResults.toString()
    ];

    // Add search parameters
    if (title) args.push("--title", title);
    if (author) args.push("--author", author);
    if (isbn) args.push("--isbn", isbn);

    // Execute the script
    ztoolkit.log("Executing search command:", pythonPath, args);

    try {
      const { exitCode, result, stderr } = await LibrarySearchModule.executeCommand(pythonPath, args);

      if (exitCode !== 0) {
        ztoolkit.log("Search script error:", stderr);
        throw new Error(getString("search-error-script-failed") + ": " + stderr);
      }

      // Parse results as JSON
      try {
        const results = JSON.parse(result.trim());
        ztoolkit.log(`Found ${results.length} results`);

        // Store results for later use
        addon.data.lastSearchResults = results;

        return results;
      } catch (e) {
        ztoolkit.log("Error parsing JSON results:", e);
        throw new Error(getString("search-error-invalid-results"));
      }
    } catch (error) {
      ztoolkit.log("Command execution error:", error);
      throw error;
    }
  }

  /**
   * Execute a command with the OS command processor
   */
  static async executeCommand(command: string, args: string[]): Promise<{ exitCode: number, result: string, stderr: string }> {
    return new Promise((resolve, reject) => {
      try {
        // Create process
        const process = Components.classes["@mozilla.org/process/util;1"]
          .createInstance(Components.interfaces.nsIProcess);

        // Initialize with command path
        const file = Components.classes["@mozilla.org/file/local;1"]
          .createInstance(Components.interfaces.nsIFile);
        file.initWithPath(command);
        process.init(file);

        // Create pipes for stdout and stderr
        const stdout = Components.classes["@mozilla.org/process/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stdout.init(false, false, 0, 0, null);

        const stderr = Components.classes["@mozilla.org/process/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stderr.init(false, false, 0, 0, null);

        // Run process and capture output
        process.run(false, args, args.length, stdout.outputStream, stderr.outputStream);

        // Read from pipes
        const stdoutData = LibrarySearchModule.readFromPipe(stdout.inputStream);
        const stderrData = LibrarySearchModule.readFromPipe(stderr.inputStream);

        // Wait for process to complete
        const checkInterval = setInterval(() => {
          if (!process.isRunning) {
            clearInterval(checkInterval);
            resolve({
              exitCode: process.exitValue,
              result: stdoutData.join(""),
              stderr: stderrData.join("")
            });
          }
        }, 100);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Read data from a pipe
   */
  static readFromPipe(inputStream: any): string[] {
    const data = [];
    const stream = Components.classes["@mozilla.org/scriptableinputstream;1"]
      .createInstance(Components.interfaces.nsIScriptableInputStream);
    stream.init(inputStream);

    let available;
    while ((available = inputStream.available()) > 0) {
      data.push(stream.read(available));
    }

    return data;
  }

  /**
   * Opens a dialog to display search results
   */
  static async openResultsDialog(results: any[]) {
    // Create dialog data
    const dialogData: { [key: string | number]: any } = {
      searchResults: results,
      selectedResults: [],
      loadCallback: () => {
        ztoolkit.log("Results dialog opened");
      },
      unloadCallback: () => {
        ztoolkit.log("Results dialog closed");
      }
    };

    // Create a function to generate HTML content for each result
    const generateResultHTML = (result: any, index: number) => {
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
        styles: {
          border: "1px solid #ccc",
          borderRadius: "4px",
          padding: "10px",
          marginBottom: "10px"
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

    // Create the dialog
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
      styles: {
        maxHeight: "500px",
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
            dialogHelper.window?.alert(getString("results-dialog-no-selection"));
            return;
          }

          try {
            await LibrarySearchModule.importResults(selectedResults);
            dialogHelper.window?.alert(getString("results-dialog-import-success"));
            dialogHelper.window?.close();
          } catch (error: any) {
            dialogHelper.window?.alert(getString("results-dialog-import-error") + ": " + error?.message);
          }
        },
        noClose: true
      })
      .addButton(getString("results-dialog-import-all"), "importAll", {
        callback: async (e) => {
          try {
            await LibrarySearchModule.importResults(results);
            dialogHelper.window?.alert(getString("results-dialog-import-success"));
            dialogHelper.window?.close();
          } catch (error: any) {
            dialogHelper.window?.alert(getString("results-dialog-import-error") + ": " + error?.message);
          }
        },
        noClose: true
      })
      .addButton(getString("results-dialog-cancel"), "cancel")
      .setDialogData(dialogData)
      .open(getString("results-dialog-title"));
  }

  /**
   * Import search results into Zotero
   */
  static async importResults(results: any[]): Promise<void> {
    if (!results || results.length === 0) {
      throw new Error("No results to import");
    }

    ztoolkit.log(`Importing ${results.length} results into Zotero`);

    // Convert results to Zotero items
    const items = results.map(result => {
      // Determine item type
      const itemType = result.issn ? "journalArticle" : "book";

      // Format creators
      const creators = [];

      // Add authors
      if (result.authors && result.authors.length > 0) {
        for (const author of result.authors) {
          let firstName = "";
          let lastName = "";

          if (author.includes(",")) {
            // Format: "Lastname, Firstname"
            const parts = author.split(",", 2);
            lastName = parts[0].trim();
            firstName = parts[1] ? parts[1].trim() : "";
          } else {
            // Format: "Firstname Lastname"
            const parts = author.split(" ");
            if (parts.length > 1) {
              lastName = parts[parts.length - 1];
              firstName = parts.slice(0, parts.length - 1).join(" ");
            } else {
              lastName = author;
            }
          }

          creators.push({
            creatorType: "author",
            firstName,
            lastName
          });
        }
      }

      // Add editors
      if (result.editors && result.editors.length > 0) {
        for (const editor of result.editors) {
          let firstName = "";
          let lastName = "";

          if (editor.includes(",")) {
            // Format: "Lastname, Firstname"
            const parts = editor.split(",", 2);
            lastName = parts[0].trim();
            firstName = parts[1] ? parts[1].trim() : "";
          } else {
            // Format: "Firstname Lastname"
            const parts = editor.split(" ");
            if (parts.length > 1) {
              lastName = parts[parts.length - 1];
              firstName = parts.slice(0, parts.length - 1).join(" ");
            } else {
              lastName = editor;
            }
          }

          creators.push({
            creatorType: "editor",
            firstName,
            lastName
          });
        }
      }

      // Create Zotero item
      const item: any = {
        itemType,
        title: result.title,
        creators,
        date: result.year,
        publisher: result.publisher_name,
        place: result.place_of_publication,
        ISBN: result.isbn,
        ISSN: result.issn,
        series: result.series,
        edition: result.edition,
        language: result.language,
        url: result.urls && result.urls.length > 0 ? result.urls[0] : "",
        abstractNote: result.abstract,
        tags: (result.subjects || []).map((subject: string) => ({ tag: subject }))
      };

      // Clean up undefined/null values
      Object.keys(item).forEach(key => {
        if (item[key] === undefined || item[key] === null) {
          delete item[key];
        }
      });

      return item;
    });

    // Create the items in Zotero
    try {
      const collection = Zotero.getActiveZoteroPane().getSelectedCollection();
      let libraryID;

      if (collection) {
        libraryID = collection.libraryID;
      } else {
        // Use the currently viewed library
        libraryID = Zotero.getActiveZoteroPane().getSelectedLibraryID();
      }

      // Import each item
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
          for (const creator of item.creators) {
            try {
              // Getting creator type ID
              const creatorID = Zotero.CreatorTypes.getID(creator.creatorType);
              
              if (creatorID) {
                // Use type assertions to bypass strict type checking
                // Try to get existing creator data
                const creatorObj = {
                  firstName: creator.firstName,
                  lastName: creator.lastName
                };
                
                const creatorDataID = (Zotero.Creators as any).getDataID(creatorObj);
                
                if (creatorDataID) {
                  // Use type assertion to bypass parameter type mismatch
                  newItem.setCreator(0, creatorDataID as any, creatorID as any);
                } else {
                  // Fallback: create a new creator
                  // Use type assertion for CreatorData constructor
                  const creatorData = new (Zotero as any).CreatorData();
                  creatorData.firstName = creator.firstName;
                  creatorData.lastName = creator.lastName;
                  creatorData.fieldMode = 0;
                  
                  // Use type assertion for save method
                  const id = (Zotero.Creators as any).save(creatorData);
                  
                  if (id) {
                    // Use type assertion to bypass parameter type mismatch
                    newItem.setCreator(0, id as any, creatorID as any);
                  }
                }
              }
            } catch (e) {
              ztoolkit.log("Error adding creator:", e);
              // Fallback: use addCreator method which might be available in some Zotero versions
              try {
                (newItem as any).addCreator({
                  firstName: creator.firstName,
                  lastName: creator.lastName,
                  creatorType: creator.creatorType
                });
              } catch (e2) {
                ztoolkit.log("Fallback creator method also failed:", e2);
              }
            }
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

      ztoolkit.log(`Successfully imported ${createdItems.length} items`);

      // Flash the items in the UI
      if (createdItems.length > 0) {
        Zotero.getActiveZoteroPane().selectItems(createdItems.map(item => item.id));
      }

      return;
    } catch (error) {
      ztoolkit.log("Error importing items:", error);
      throw error;
    }
  }

  /**
   * Opens the Library Search for API use
   */
  static openSearch() {
    addon.hooks.onDialogEvents("openSearch");
  }
}