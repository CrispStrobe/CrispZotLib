import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { ThemeUtils } from "./themeUtils";
import { safeConsole } from "../utils/ztoolkit";

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

/**
 * Enhanced dialog creation with proper styling
 * @param rows Number of rows
 * @param cols Number of columns
 * @returns Dialog helper with enhanced styling
 */
function createStyledDialog(rows: number, cols: number): any {
  // Create the dialog helper using any type to avoid TypeScript errors
  const dialogHelper: any = new ztoolkit.Dialog(rows, cols);
  
  // Store the original open method
  const originalOpen = dialogHelper.open;
  
  // Override the open method with our enhanced version
  dialogHelper.open = function(title: string, windowFeatures?: any) {
    // Call the original method
    const result = originalOpen.call(this, title, windowFeatures);
    
    try {
      // Check if we have a window
      if (result && result.window) {
        const win = result.window;
        
        if (win.document) {
          // Apply dark mode
          ThemeUtils.applyTheme(win);
          
          // Add styling class
          const doc = win.document;
          if (doc.body) {
            doc.body.classList.add('librarysearch-dialog');
            
            // Add container
            const container = doc.createElement('div');
            container.className = 'dialog-container';
            
            // Move elements to container
            while (doc.body.childNodes.length > 0) {
              container.appendChild(doc.body.childNodes[0]);
            }
            
            doc.body.appendChild(container);
            
            // Style header if exists
            const h1Elements = doc.getElementsByTagName('h1');
            if (h1Elements.length > 0 && h1Elements[0].parentNode) {
              const headerDiv = doc.createElement('div');
              headerDiv.className = 'dialog-header';
              h1Elements[0].parentNode.insertBefore(headerDiv, h1Elements[0]);
              headerDiv.appendChild(h1Elements[0]);
            }
            
            // Style buttons
            const buttons = doc.querySelectorAll('button');
            if (buttons.length > 0) {
              // Create button container
              let buttonContainer = doc.querySelector('.button-container');
              if (!buttonContainer) {
                buttonContainer = doc.createElement('div');
                buttonContainer.className = 'button-container';
                container.appendChild(buttonContainer);
                
                // Move buttons
                for (let i = 0; i < buttons.length; i++) {
                  const button = buttons[i] as HTMLButtonElement;
                  
                  // Remove from current location
                  if (button.parentNode) {
                    button.parentNode.removeChild(button);
                  }
                  
                  // Style primary buttons
                  if (button.id === 'search' || button.id === 'import' || 
                      button.id === 'importAll' || 
                      (button.textContent && button.textContent.includes('Search'))) {
                    button.classList.add('primary');
                  }
                  
                  // Add to container
                  buttonContainer.appendChild(button);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      ztoolkit.log('Error styling dialog:', e);
    }
    
    return result;
  };
  
  return dialogHelper;
}


/**
 * LibrarySearchModule - Handles searching library catalogs through Python script integration
 * 
 * This module provides functionality for searching library catalogs via a Python script
 * and importing the results into Zotero.
 */
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
  
  // Log current values for debugging
  ztoolkit.log("Initial paths from prefs:", { pythonPath, scriptPath });

  // Create dialog data with default values
  const dialogData = {
    pythonPath: pythonPath,
    scriptPath: scriptPath,
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

  // Create the dialog helper
  const dialogHelper = createStyledDialog(12, 2)
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
        value: dialogData.pythonPath
      },
      styles: { width: "100%" },
      listeners: [{
        type: "input",
        listener: (e: Event) => {
          dialogData.pythonPath = (e.target as HTMLInputElement).value;
        }
      }]
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
        value: dialogData.scriptPath
      },
      styles: { width: "100%" },
      listeners: [{
        type: "input",
        listener: (e: Event) => {
          dialogData.scriptPath = (e.target as HTMLInputElement).value;
        }
      }]
    })

    // Search section
    .addCell(5, 0, {
      tag: "h3",
      properties: { innerHTML: getString("search-dialog-search-section") },
      styles: { gridColumn: "1 / span 2", marginBottom: "5px", marginTop: "15px" }
    })

    // Protocol - Using radio buttons
    .addCell(6, 0, {
      tag: "label",
      namespace: "html",
      properties: { innerHTML: getString("search-dialog-protocol") },
    })
    .addCell(6, 1, {
      tag: "div",
      namespace: "html",
      styles: { display: "flex", gap: "10px" },
      children: [
        {
          tag: "div",
          styles: { display: "flex", alignItems: "center", gap: "5px" },
          children: [
            {
              tag: "input",
              namespace: "html",
              id: "protocol-sru",
              attributes: {
                type: "radio",
                name: "protocol",
                value: "sru",
                checked: "checked"
              },
              listeners: [{
                type: "change",
                listener: (e: Event) => {
                  if ((e.target as HTMLInputElement).checked) {
                    dialogData.protocol = "sru";
                    // Set default endpoint for SRU
                    dialogData.endpoint = "dnb";
                    
                    // Update endpoint input field
                    if (dialogHelper.window) {
                      const endpointInput = dialogHelper.window.document.getElementById("endpoint-input") as HTMLInputElement;
                      if (endpointInput) {
                        endpointInput.value = "dnb";
                      }
                      
                      // Show SRU helper text, hide others
                      const sruHelperText = dialogHelper.window.document.getElementById("sru-helper-text");
                      const oaiHelperText = dialogHelper.window.document.getElementById("oai-helper-text");
                      const ixtheoHelperText = dialogHelper.window.document.getElementById("ixtheo-helper-text");
                      
                      if (sruHelperText && oaiHelperText && ixtheoHelperText) {
                        sruHelperText.style.display = "block";
                        oaiHelperText.style.display = "none";
                        ixtheoHelperText.style.display = "none";
                      }
                    }
                  }
                }
              }]
            },
            {
              tag: "label",
              namespace: "html",
              attributes: { for: "protocol-sru" },
              properties: { innerHTML: "SRU" }
            }
          ]
        },
        {
          tag: "div",
          styles: { display: "flex", alignItems: "center", gap: "5px" },
          children: [
            {
              tag: "input",
              namespace: "html",
              id: "protocol-oai",
              attributes: {
                type: "radio",
                name: "protocol",
                value: "oai"
              },
              listeners: [{
                type: "change",
                listener: (e: Event) => {
                  if ((e.target as HTMLInputElement).checked) {
                    dialogData.protocol = "oai";
                    // Set default endpoint for OAI
                    dialogData.endpoint = "crossref";
                    
                    // Update endpoint input field
                    if (dialogHelper.window) {
                      const endpointInput = dialogHelper.window.document.getElementById("endpoint-input") as HTMLInputElement;
                      if (endpointInput) {
                        endpointInput.value = "crossref";
                      }
                      
                      // Show OAI helper text, hide others
                      const sruHelperText = dialogHelper.window.document.getElementById("sru-helper-text");
                      const oaiHelperText = dialogHelper.window.document.getElementById("oai-helper-text");
                      const ixtheoHelperText = dialogHelper.window.document.getElementById("ixtheo-helper-text");
                      
                      if (sruHelperText && oaiHelperText && ixtheoHelperText) {
                        sruHelperText.style.display = "none";
                        oaiHelperText.style.display = "block";
                        ixtheoHelperText.style.display = "none";
                      }
                    }
                  }
                }
              }]
            },
            {
              tag: "label",
              namespace: "html",
              attributes: { for: "protocol-oai" },
              properties: { innerHTML: "OAI-PMH" }
            }
          ]
        },
        {
          tag: "div",
          styles: { display: "flex", alignItems: "center", gap: "5px" },
          children: [
            {
              tag: "input",
              namespace: "html",
              id: "protocol-ixtheo",
              attributes: {
                type: "radio",
                name: "protocol",
                value: "ixtheo"
              },
              listeners: [{
                type: "change",
                listener: (e: Event) => {
                  if ((e.target as HTMLInputElement).checked) {
                    dialogData.protocol = "ixtheo";
                    // Set default endpoint for IxTheo
                    dialogData.endpoint = "ris";
                    
                    // Update endpoint input field
                    if (dialogHelper.window) {
                      const endpointInput = dialogHelper.window.document.getElementById("endpoint-input") as HTMLInputElement;
                      if (endpointInput) {
                        endpointInput.value = "ris";
                      }
                      
                      // Show IxTheo helper text, hide others
                      const sruHelperText = dialogHelper.window.document.getElementById("sru-helper-text");
                      const oaiHelperText = dialogHelper.window.document.getElementById("oai-helper-text");
                      const ixtheoHelperText = dialogHelper.window.document.getElementById("ixtheo-helper-text");
                      
                      if (sruHelperText && oaiHelperText && ixtheoHelperText) {
                        sruHelperText.style.display = "none";
                        oaiHelperText.style.display = "none";
                        ixtheoHelperText.style.display = "block";
                      }
                    }
                  }
                }
              }]
            },
            {
              tag: "label",
              namespace: "html",
              attributes: { for: "protocol-ixtheo" },
              properties: { innerHTML: "IxTheo" }
            }
          ]
        }
      ]
    })

    // Endpoint - Use input field with helper text instead of dropdown
    .addCell(7, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "endpoint-input" },
      properties: { innerHTML: getString("search-dialog-endpoint") },
    })
    .addCell(7, 1, {
      tag: "div",
      namespace: "html",
      children: [
        // Input field for endpoint
        {
          tag: "input",
          namespace: "html",
          id: "endpoint-input",
          attributes: {
            type: "text",
            value: "dnb" // Default value
          },
          styles: { width: "100%", marginBottom: "5px" },
          listeners: [{
            type: "input",
            listener: (e: Event) => {
              dialogData.endpoint = (e.target as HTMLInputElement).value;
            }
          }]
        },
        // SRU helper text - Visible by default
        {
          tag: "div",
          namespace: "html",
          id: "sru-helper-text",
          styles: { fontSize: "12px", color: "#808080", marginTop: "2px" },
          properties: { 
            innerHTML: "SRU options: dnb, bnf, zdb, loc, trove, kb, bibsys" 
          }
        },
        // OAI helper text - Hidden initially
        {
          tag: "div",
          namespace: "html",
          id: "oai-helper-text",
          styles: { fontSize: "12px", color: "#808080", marginTop: "2px", display: "none" },
          properties: { 
            innerHTML: "OAI options: dnb, dnb_digital, loc, europeana, ddb, harvard, mit, kitopen, arxiv, doaj" 
          }
        },
        // IxTheo helper text - Hidden initially
        {
          tag: "div",
          namespace: "html",
          id: "ixtheo-helper-text",
          styles: { fontSize: "12px", color: "#808080", marginTop: "2px", display: "none" },
          properties: { 
            innerHTML: "IxTheo options: ris, marc, html" 
          }
        }
      ]
    })

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
    .addButton(getString("search-dialog-search-button"), "search", {
      callback: async (e: Event) => {
        // Prevent multiple searches
        if (dialogData.searching) {
          return;
        }
      
        // Save the Python and script paths to preferences
        if (dialogData.pythonPath) {
          setPref("pythonPath", dialogData.pythonPath.trim());
        }
        if (dialogData.scriptPath) {
          setPref("scriptPath", dialogData.scriptPath.trim());
        }
        
        // Get the current values from UI elements
        if (dialogHelper.window) {
          const doc = dialogHelper.window.document;
          
          // Get protocol from radio buttons
          const selectedProtocol = doc.querySelector('input[name="protocol"]:checked') as HTMLInputElement;
          if (selectedProtocol) {
            dialogData.protocol = selectedProtocol.value;
          }
          
          // Get endpoint from input field
          const endpointInput = doc.getElementById('endpoint-input') as HTMLInputElement;
          if (endpointInput) {
            dialogData.endpoint = endpointInput.value;
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
          searchButton.textContent = getString("search-dialog-searching");
        }
      
        try {
          ztoolkit.log("Search parameters:", {
            pythonPath: dialogData.pythonPath,
            scriptPath: dialogData.scriptPath,
            protocol: dialogData.protocol,
            endpoint: dialogData.endpoint,
            title: dialogData.title,
            author: dialogData.author,
            isbn: dialogData.isbn,
            maxResults: dialogData.maxResults
          });
      
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
      
          // Run the search
          const results = await LibrarySearchModule.runSearch(searchParams);

          // Open results dialog if we have results
          if (results && results.length > 0) {
            await LibrarySearchModule.openResultsDialog(results);
          } else {
            dialogData.errorMessage = getString("search-dialog-no-results");
            if (dialogHelper.window) {
              dialogHelper.window.alert(getString("search-dialog-no-results"));
            }
          }
        } catch (error: any) {
          ztoolkit.log("Search error:", error);
          dialogData.errorMessage = error?.message || getString("search-dialog-error");
          
          if (dialogHelper.window) {
            dialogHelper.window.alert(dialogData.errorMessage);
          }
        } finally {
          // Reset search button
          dialogData.searching = false;
          if (searchButton) {
            searchButton.disabled = false;
            searchButton.textContent = getString("search-dialog-search-button");
          }
        }
      },
      noClose: true
    })
    .addButton(getString("search-dialog-cancel-button"), "cancel");

  // Set dialog data
  dialogHelper.setDialogData(dialogData);

  // Open the dialog
  dialogHelper.open(getString("search-dialog-title"));
  
  // Store the dialog reference
  addon.data.dialog = dialogHelper;
}
   

  /**
   * Opens a dialog to display search results
   */
  static async openResultsDialog(results: any[]) {
    // Create dialog data
    const dialogData: { [key: string | number]: any } = {
      searchResults: results,
      selectedResults: [],
      loadCallback: (window: Window) => {
        ztoolkit.log("Results dialog opened");
        ThemeUtils.applyTheme(window);
      },
      unloadCallback: () => {
        ztoolkit.log("Results dialog closed");
      }
    };

    // Function to generate HTML content for each result
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
            await LibrarySearchModule.importResults(selectedResults);
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
      .addButton(getString("results-dialog-import-all"), "importAll", {
        callback: async (e) => {
          try {
            await LibrarySearchModule.importResults(results);
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
  }

  static async runSearch(searchParams: any): Promise<any[]> {
    const { pythonPath, scriptPath, protocol, endpoint, title, author, isbn, maxResults } = searchParams;
    
    // Create a log collection for debugging
    const debugLogs: string[] = [];
    const log = (message: string) => {
      ztoolkit.log(message);
      debugLogs.push(message);
    };
    
    log("========== SEARCH PARAMETERS ==========");
    log(`Python Path: "${pythonPath}"`);
    log(`Script Path: "${scriptPath}"`);
    log(`Protocol: "${protocol}"`);
    log(`Endpoint: "${endpoint}"`);
    log(`Title: "${title || 'None'}"`);
    log(`Author: "${author || 'None'}"`);
    log(`ISBN: "${isbn || 'None'}"`);
    log(`Max Results: ${maxResults}`);
    log("======================================");
    
    // Validation checks for paths
    if (!pythonPath || !scriptPath) {
      throw new Error(getString("search-error-missing-paths"));
    }
    
    // Check if Python and script paths exist
    try {
      const pythonFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      pythonFile.initWithPath(pythonPath);
      
      const scriptFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      scriptFile.initWithPath(scriptPath);
      
      if (!pythonFile.exists() || !scriptFile.exists()) {
        throw new Error("Python or script path does not exist");
      }
    } catch (e) {
      log(`Error checking paths: ${String(e)}`);
      throw new Error(`Invalid Python or script path: ${String(e)}`);
    }
    
    // Build command args
    const args = [
      scriptPath,
      '--protocol', protocol,
      '--endpoint', endpoint,
      '--format', 'json',
      '--max-records', maxResults.toString()
    ];
    
    if (title) args.push('--title', title);
    if (author) args.push('--author', author);
    if (isbn) args.push('--isbn', isbn);
    
    const testCommand = `${pythonPath} ${args.join(' ')}`;
    log("Test command: " + testCommand);
    
    // Use synchronous execution with system shell
    try {
      log("Executing command through system shell...");
      
      let shellCommand;
      let shellArgs;
      
      // Create temporary output file path
      const timestamp = Date.now();
      const tempOutputPath = Zotero.isWin 
        ? `C:\\Temp\\zotero_out_${timestamp}.json`
        : `/tmp/zotero_out_${timestamp}.json`;
      
      // Set up shell command with output redirection
      if (Zotero.isWin) {
        shellCommand = 'cmd.exe';
        shellArgs = ['/c', `"${pythonPath}" ${args.join(' ')} > "${tempOutputPath}"`];
      } else {
        shellCommand = '/bin/sh';
        shellArgs = ['-c', `"${pythonPath}" ${args.join(' ')} > "${tempOutputPath}"`];
      }
      
      log(`Shell command: ${shellCommand} ${shellArgs.join(' ')}`);
      
      // Execute the shell command synchronously
      const shellFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      shellFile.initWithPath(shellCommand);
      
      // Create and initialize process
      const process = Components.classes["@mozilla.org/process/util;1"]
        .createInstance(Components.interfaces.nsIProcess);
      process.init(shellFile);
      
      // Run synchronously
      process.run(true, shellArgs, shellArgs.length);
      
      log(`Command completed with exit code: ${process.exitValue}`);
      log(`Checking for output file: ${tempOutputPath}`);
      
      // Check if output file exists
      const outputFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      outputFile.initWithPath(tempOutputPath);
      
      if (!outputFile.exists()) {
        throw new Error(`Output file not created: ${tempOutputPath}`);
      }
      
      // Now read the file using a very simple approach
      const tempResultPath = tempOutputPath + ".read.txt";
      
      // Execute a simple cat/type command to read the file
      let readCommand;
      let readArgs;
      
      if (Zotero.isWin) {
        readCommand = 'cmd.exe';
        readArgs = ['/c', `type "${tempOutputPath}" > "${tempResultPath}"`];
      } else {
        readCommand = '/bin/sh';
        readArgs = ['-c', `cat "${tempOutputPath}" > "${tempResultPath}"`];
      }
      
      log(`Reading file using: ${readCommand} ${readArgs.join(' ')}`);
      
      const readFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      readFile.initWithPath(readCommand);
      
      const readProcess = Components.classes["@mozilla.org/process/util;1"]
        .createInstance(Components.interfaces.nsIProcess);
      readProcess.init(readFile);
      
      readProcess.run(true, readArgs, readArgs.length);
      
      // This is now a simpler file that hopefully we can read directly
      log(`Checking for read result file: ${tempResultPath}`);
      
      // Try to read the content as a plain text file
      const resultFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      resultFile.initWithPath(tempResultPath);
      
      if (!resultFile.exists()) {
        throw new Error(`Result file not created: ${tempResultPath}`);
      }
      
      // Use FileUtils to read the file as text (less prone to TypeScript errors)
      // We'll use a simple XMLHttpRequest to load a local file
      const fileUrl = `file://${tempResultPath}`;
      log(`Loading file URL: ${fileUrl}`);
      
      const xhr = new XMLHttpRequest();
      xhr.open("GET", fileUrl, false); // synchronous request
      xhr.overrideMimeType("application/json");
      xhr.send(null);
      
      if (xhr.status === 0 || xhr.status === 200) {
        const content = xhr.responseText || "";
        log(`File content length: ${content.length}`);
        
        // Clean up temporary files
        try {
          outputFile.remove(false);
          resultFile.remove(false);
        } catch (e) {
          log(`Warning: Could not remove temporary files: ${String(e)}`);
        }
        
        if (content && content.length > 0) {
          try {
            // Modified parsing approach - extract JSON objects
            log("Extracting individual JSON objects from output");
            
            // Method 1: Try to parse as a single JSON array
            try {
              const results = JSON.parse(content);
              log("Successfully parsed entire content as JSON");
              
              if (Array.isArray(results)) {
                return results;
              } else {
                return [results]; // Wrap single object in array
              }
            } catch (e) {
              log(`Could not parse as complete JSON: ${String(e)}`);
              // Continue to alternate parsing methods
            }
            
            // Method 2: Extract individual JSON objects
            log("Trying to extract individual JSON objects");
            const jsonObjects = [];
            
            // Regular expression to find JSON objects (matches content between { and })
            const objectRegex = /{[^{]*(?:{[^{}]*}[^{}]*)*}/g;
            let match;
            
            while ((match = objectRegex.exec(content)) !== null) {
              try {
                const obj = JSON.parse(match[0]);
                jsonObjects.push(obj);
                log(`Found JSON object: ${match[0].substring(0, 50)}...`);
              } catch (e) {
                log(`Failed to parse potential JSON object: ${match[0].substring(0, 50)}...`);
              }
            }
            
            if (jsonObjects.length > 0) {
              log(`Successfully extracted ${jsonObjects.length} JSON objects`);
              return jsonObjects;
            }
            
            // Method 3: Try line-by-line approach for JSON objects
            log("Trying line-by-line JSON object extraction");
            const lines = content.split('\n');
            const lineObjects = [];
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('{') && line.endsWith('}')) {
                try {
                  const obj = JSON.parse(line);
                  lineObjects.push(obj);
                  log(`Found JSON object on line ${i+1}`);
                } catch (e) {
                  log(`Failed to parse line ${i+1} as JSON`);
                }
              }
            }
            
            if (lineObjects.length > 0) {
              log(`Successfully extracted ${lineObjects.length} JSON objects from lines`);
              return lineObjects;
            }
            
            // Method 4: Manually extract each result section
            log("Trying to extract JSON between result markers");
            const resultSections = content.split('--- Result');
            const sectionObjects = [];
            
            for (let i = 1; i < resultSections.length; i++) {
              const section = resultSections[i];
              // Extract the JSON part (after the "of X ---" header)
              const jsonStartIndex = section.indexOf('{');
              const jsonEndIndex = section.lastIndexOf('}');
              
              if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
                const jsonText = section.substring(jsonStartIndex, jsonEndIndex + 1);
                try {
                  const obj = JSON.parse(jsonText);
                  sectionObjects.push(obj);
                  log(`Successfully parsed result section ${i}`);
                } catch (e) {
                  log(`Failed to parse result section ${i}: ${e}`);
                }
              }
            }
            
            if (sectionObjects.length > 0) {
              log(`Successfully extracted ${sectionObjects.length} objects from result sections`);
              return sectionObjects;
            }
            
            throw new Error("Could not extract any valid JSON objects from the output");
          } catch (e) {
            throw new Error(`Error parsing result: ${String(e)}`);
          }
        } else {
          throw new Error("Output file was empty");
        }
      } else {
        throw new Error(`Failed to load file: ${xhr.status} ${xhr.statusText}`);
      }
    } catch (error) {
      // Show debug dialog and rethrow
      this.showDebugDialog(
        "Search Issue",
        `Error executing search: ${String(error)}`,
        debugLogs.join("\n")
      );
      throw error;
    }
  }

  /**
   * Runs a search using the library_search.py script
   * Includes robust error handling and multiple approaches to capture output
   */
  static async NonWorkingrunSearch(searchParams: any): Promise<any[]> {
    const { pythonPath, scriptPath, protocol, endpoint, title, author, isbn, maxResults } = searchParams;
    
    // Create a log collection to show in UI if needed
    const debugLogs: string[] = [];
    
    // Helper to add to both Zotero logs and our debug collection
    const log = (message: string) => {
      ztoolkit.log(message);
      debugLogs.push(message);
    };
    
    log("========== SEARCH PARAMETERS ==========");
    log(`Python Path: "${pythonPath}"`);
    log(`Script Path: "${scriptPath}"`);
    log(`Protocol: "${protocol}"`);
    log(`Endpoint: "${endpoint}"`);
    log(`Title: "${title || 'None'}"`);
    log(`Author: "${author || 'None'}"`);
    log(`ISBN: "${isbn || 'None'}"`);
    log(`Max Results: ${maxResults}`);
    log("======================================");
    
    // Validate paths first
    if (!pythonPath || !scriptPath) {
      throw new Error(getString("search-error-missing-paths"));
    }
    
    // Check if Python path exists
    try {
      const pythonFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      pythonFile.initWithPath(pythonPath);
      
      if (!pythonFile.exists()) {
        log(`ERROR: Python executable not found at: "${pythonPath}"`);
        throw new Error(`Python executable not found at: ${pythonPath}`);
      }
      
      log(`✓ Python executable exists at "${pythonPath}"`);
    } catch (e) {
      log(`ERROR checking Python path: ${String(e)}`);
      throw new Error(`Invalid Python path: ${pythonPath}. Error: ${String(e)}`);
    }
    
    // Check if script path exists
    try {
      const scriptFile = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      scriptFile.initWithPath(scriptPath);
      
      if (!scriptFile.exists()) {
        log(`ERROR: Script not found at: "${scriptPath}"`);
        throw new Error(`Script not found at: ${scriptPath}`);
      }
      
      log(`✓ Script exists at "${scriptPath}"`);
    } catch (e) {
      log(`ERROR checking script path: ${String(e)}`);
      throw new Error(`Invalid script path: ${scriptPath}. Error: ${String(e)}`);
    }
    
    // Generate a unique timestamp for temp files
    const timestamp = Date.now();
    
    // Determine system-appropriate temp directory for output file
    let outputPath: string;
    if (Zotero.isWin) {
      outputPath = `C:\\Temp\\zotero_search_${timestamp}.json`;
    } else if (Zotero.isMac) {
      outputPath = `/tmp/zotero_search_${timestamp}.json`;
    } else {
      // Linux or other
      outputPath = `/tmp/zotero_search_${timestamp}.json`;
    }
    
    log(`Will use output file: ${outputPath}`);
    
    // -------- APPROACH 1: OUTPUT TO FILE --------
    log("\n=== TRYING APPROACH 1: Output to File ===");
    
    // Build command args with output file
    const fileOutputArgs = [
      scriptPath,
      '--protocol', protocol,
      '--endpoint', endpoint,
      '--format', 'json',
      '--max-records', maxResults.toString(),
      '--output', outputPath
    ];
    
    if (title) fileOutputArgs.push('--title', title);
    if (author) fileOutputArgs.push('--author', author);
    if (isbn) fileOutputArgs.push('--isbn', isbn);
    
    // Command string for debugging/testing
    const fileOutputCmd = `${pythonPath} ${fileOutputArgs.join(' ')}`;
    log(`Command: ${fileOutputCmd}`);
    
    try {
      log("Executing command (output to file)...");
      const { exitCode, result, stderr } = await this.executeCommand(pythonPath, fileOutputArgs);
      
      log(`Exit code: ${exitCode}`);
      log(`Result length: ${result ? result.length : 0}`);
      log(`Stderr: ${stderr || '(none)'}`);
      
      if (exitCode !== 0) {
        log(`Command failed with exit code ${exitCode}, will try other approaches`);
      } else {
        log("Command executed successfully, checking for output file...");
        
        // Check if output file was created
        try {
          const outputFile = Components.classes["@mozilla.org/file/local;1"]
            .createInstance(Components.interfaces.nsIFile);
          outputFile.initWithPath(outputPath);
          
          if (outputFile.exists()) {
            log(`✓ Output file exists: ${outputPath}`);
            
            // Read the file contents
            try {
              // Use a more compatible approach for file reading
              const fileContents = await this.readFile(outputPath);
              log(`Read ${fileContents.length} bytes from output file`);
              
              if (fileContents && fileContents.length > 0) {
                log(`File content (first 200 chars): ${fileContents.substring(0, 200)}...`);
                
                try {
                  const parsedData = JSON.parse(fileContents);
                  log("✓ Successfully parsed JSON data from file");
                  
                  // Clean up the file
                  try {
                    outputFile.remove(false);
                    log("Removed temporary output file");
                  } catch (e) {
                    log(`Warning: Could not remove temporary file: ${e}`);
                  }
                  
                  if (Array.isArray(parsedData)) {
                    log(`Success: Found array with ${parsedData.length} items`);
                    addon.data.lastSearchResults = parsedData;
                    return parsedData;
                  } else if (typeof parsedData === 'object') {
                    // Single object - wrap in array
                    log("Success: Found single object, wrapping in array");
                    const results = [parsedData];
                    addon.data.lastSearchResults = results;
                    return results;
                  } else {
                    throw new Error(`Invalid data type: ${typeof parsedData}`);
                  }
                } catch (parseError) {
                  log(`ERROR parsing JSON from file: ${String(parseError)}`);
                  // Continue to next approach
                }
              } else {
                log("Output file exists but is empty");
              }
            } catch (readError) {
              log(`ERROR reading output file: ${String(readError)}`);
            }
          } else {
            log(`Output file was not created: ${outputPath}`);
          }
        } catch (fileError) {
          log(`ERROR checking output file: ${String(fileError)}`);
        }
      }
    } catch (approachError) {
      log(`Error in Approach 1: ${String(approachError)}`);
    }
    
    // -------- APPROACH 2: DIRECT OUTPUT CAPTURE --------
    log("\n=== TRYING APPROACH 2: Direct Output Capture ===");
    
    // Build command args without output file
    const directOutputArgs = [
      scriptPath,
      '--protocol', protocol,
      '--endpoint', endpoint,
      '--format', 'json',
      '--max-records', maxResults.toString()
    ];
    
    if (title) directOutputArgs.push('--title', title);
    if (author) directOutputArgs.push('--author', author);
    if (isbn) directOutputArgs.push('--isbn', isbn);
    
    // Command string for debugging/testing
    const directOutputCmd = `${pythonPath} ${directOutputArgs.join(' ')}`;
    log(`Command: ${directOutputCmd}`);
    
    try {
      log("Executing command (direct output)...");
      const { exitCode, result, stderr } = await this.executeCommand(
        pythonPath, 
        directOutputArgs
      );
      
      log(`Exit code: ${exitCode}`);
      log(`Result length: ${result ? result.length : 0}`);
      log(`Stderr: ${stderr || '(none)'}`);
      
      if (exitCode !== 0) {
        log(`Command failed with exit code ${exitCode}, will try other approaches`);
      } else if (result && result.length > 0) {
        log(`Result (first 200 chars): ${result.substring(0, 200)}...`);
        
        try {
          const parsedData = JSON.parse(result);
          log("✓ Successfully parsed JSON from direct output");
          
          if (Array.isArray(parsedData)) {
            log(`Success: Found array with ${parsedData.length} items`);
            addon.data.lastSearchResults = parsedData;
            return parsedData;
          } else if (typeof parsedData === 'object') {
            // Single object - wrap in array
            log("Success: Found single object, wrapping in array");
            const results = [parsedData];
            addon.data.lastSearchResults = results;
            return results;
          } else {
            throw new Error(`Invalid data type: ${typeof parsedData}`);
          }
        } catch (parseError) {
          log(`ERROR parsing JSON from direct output: ${String(parseError)}`);
          // Continue to next approach
        }
      } else {
        log("Command returned empty output");
      }
    } catch (approachError) {
      log(`Error in Approach 2: ${String(approachError)}`);
    }
    
    // -------- APPROACH 3: PYTHON SUBPROCESS MODULE --------
    log("\n=== TRYING APPROACH 3: Python Subprocess Module ===");
    
    // Prepare a Python command that uses subprocess to capture output
    const escapedTitle = title ? title.replace(/"/g, '\\"') : '';
    const escapedAuthor = author ? author.replace(/"/g, '\\"') : '';
    const escapedISBN = isbn ? isbn.replace(/"/g, '\\"') : '';
    
    const pythonCode = `
import json, subprocess, sys

cmd = [
  "${pythonPath.replace(/\\/g, '\\\\')}", 
  "${scriptPath.replace(/\\/g, '\\\\')}", 
  "--protocol", "${protocol}", 
  "--endpoint", "${endpoint}", 
  "--format", "json", 
  "--max-records", "${maxResults}"
]

${title ? `cmd.extend(["--title", "${escapedTitle}"])` : ''}
${author ? `cmd.extend(["--author", "${escapedAuthor}"])` : ''}
${isbn ? `cmd.extend(["--isbn", "${escapedISBN}"])` : ''}

try:
  result = subprocess.run(cmd, capture_output=True, text=True, check=False)
  print(json.dumps({
    "exit_code": result.returncode,
    "stdout": result.stdout,
    "stderr": result.stderr
  }))
except Exception as e:
  print(json.dumps({
    "exit_code": -1,
    "stdout": "",
    "stderr": str(e)
  }))
`;

    const tempScriptPath = outputPath.replace('.json', '.py');
    log(`Writing Python script to: ${tempScriptPath}`);
    
    try {
      // Write the Python code to the temp file using our helper
      await this.writeFile(tempScriptPath, pythonCode);
      log("Executing Python subprocess script...");
      
      const { exitCode, result, stderr } = await this.executeCommand(
        pythonPath, 
        [tempScriptPath]
      );
      
      // Clean up the temp script file
      try {
        const tempScript = Components.classes["@mozilla.org/file/local;1"]
          .createInstance(Components.interfaces.nsIFile);
        tempScript.initWithPath(tempScriptPath);
        if (tempScript.exists()) {
          tempScript.remove(false);
        }
      } catch (e) {
        log(`Warning: Could not remove temporary script: ${String(e)}`);
      }
      
      log(`Subprocess exit code: ${exitCode}`);
      log(`Subprocess result length: ${result ? result.length : 0}`);
      
      if (exitCode !== 0) {
        log(`Subprocess script failed with exit code ${exitCode}`);
        log(`Stderr: ${stderr}`);
      } else if (result && result.length > 0) {
        log(`Subprocess result (first 200 chars): ${result.substring(0, 200)}...`);
        
        try {
          const subprocessResult = JSON.parse(result);
          
          log(`Script exit code: ${subprocessResult.exit_code}`);
          log(`Script stdout length: ${subprocessResult.stdout ? subprocessResult.stdout.length : 0}`);
          log(`Script stderr: ${subprocessResult.stderr || '(none)'}`);
          
          if (subprocessResult.stdout && subprocessResult.stdout.length > 0) {
            log(`Script stdout (first 200 chars): ${subprocessResult.stdout.substring(0, 200)}...`);
            
            try {
              const parsedData = JSON.parse(subprocessResult.stdout);
              log("✓ Successfully parsed JSON from subprocess output");
              
              if (Array.isArray(parsedData)) {
                log(`Success: Found array with ${parsedData.length} items`);
                addon.data.lastSearchResults = parsedData;
                return parsedData;
              } else if (typeof parsedData === 'object') {
                // Single object - wrap in array
                log("Success: Found single object, wrapping in array");
                const results = [parsedData];
                addon.data.lastSearchResults = results;
                return results;
              } else {
                throw new Error(`Invalid data type: ${typeof parsedData}`);
              }
            } catch (parseError) {
              log(`ERROR parsing JSON from subprocess output: ${String(parseError)}`);
              // Continue to next approach
            }
          } else {
            log("Subprocess returned empty stdout");
          }
        } catch (jsonError) {
          log(`ERROR parsing subprocess result JSON: ${String(jsonError)}`);
        }
      } else {
        log("Subprocess returned empty result");
      }
    } catch (approachError) {
      log(`Error in Approach 3: ${String(approachError)}`);
    }
    
    // -------- APPROACH 4: Try Python -c flag --------
    log("\n=== TRYING APPROACH 4: Python -c flag ===");
    
    // This approach uses Python's -c flag to run a Python program that executes our script
    // This gives better control over how Python runs and captures output
    const pyEscapedTitle = title ? title.replace(/'/g, "\\'") : '';
    const pyEscapedAuthor = author ? author.replace(/'/g, "\\'") : '';
    const pyEscapedISBN = isbn ? isbn.replace(/'/g, "\\'") : '';

    const inlinePythonCode = `
import sys, json, subprocess
cmd = [sys.executable, '${scriptPath.replace(/'/g, "\\'")}', 
  '--protocol', '${protocol}', '--endpoint', '${endpoint}', 
  '--format', 'json', '--max-records', '${maxResults}'
]
${title ? `cmd.extend(['--title', '${pyEscapedTitle}'])` : ''}
${author ? `cmd.extend(['--author', '${pyEscapedAuthor}'])` : ''}
${isbn ? `cmd.extend(['--isbn', '${pyEscapedISBN}'])` : ''}
try:
  result = subprocess.run(cmd, capture_output=True, text=True)
  print(result.stdout)
except Exception as e:
  sys.stderr.write(str(e))
  sys.exit(1)
`;

    try {
      log("Executing Python with -c flag...");
      const { exitCode, result, stderr } = await this.executeCommand(
        pythonPath,
        ['-c', inlinePythonCode]
      );
      
      log(`Python -c exit code: ${exitCode}`);
      log(`Python -c result length: ${result ? result.length : 0}`);
      log(`Python -c stderr: ${stderr || '(none)'}`);
      
      if (exitCode !== 0) {
        log(`Python -c failed with exit code ${exitCode}`);
      } else if (result && result.length > 0) {
        log(`Python -c result (first 200 chars): ${result.substring(0, 200)}...`);
        
        try {
          const parsedData = JSON.parse(result);
          log("✓ Successfully parsed JSON from Python -c output");
          
          if (Array.isArray(parsedData)) {
            log(`Success: Found array with ${parsedData.length} items`);
            addon.data.lastSearchResults = parsedData;
            return parsedData;
          } else if (typeof parsedData === 'object') {
            // Single object - wrap in array
            log("Success: Found single object, wrapping in array");
            const results = [parsedData];
            addon.data.lastSearchResults = results;
            return results;
          } else {
            throw new Error(`Invalid data type: ${typeof parsedData}`);
          }
        } catch (parseError) {
          log(`ERROR parsing JSON from Python -c output: ${String(parseError)}`);
        }
      } else {
        log("Python -c returned empty result");
      }
    } catch (approachError) {
      log(`Error in Approach 4: ${String(approachError)}`);
    }
    
    // -------- APPROACH 5: Try to run directly with system shell --------
    log("\n=== TRYING APPROACH 5: System shell ===");
    
    let shellCommand: string;
    let shellArgs: string[];
    
    if (Zotero.isWin) {
      // Windows: use cmd.exe
      shellCommand = 'cmd.exe';
      shellArgs = ['/c', `"${pythonPath}" "${scriptPath}" --protocol ${protocol} --endpoint ${endpoint} --format json --max-records ${maxResults}${title ? ` --title "${title}"` : ''}${author ? ` --author "${author}"` : ''}${isbn ? ` --isbn "${isbn}"` : ''}`];
    } else {
      // Unix: use sh
      shellCommand = '/bin/sh';
      shellArgs = ['-c', `"${pythonPath}" "${scriptPath}" --protocol ${protocol} --endpoint ${endpoint} --format json --max-records ${maxResults}${title ? ` --title "${title}"` : ''}${author ? ` --author "${author}"` : ''}${isbn ? ` --isbn "${isbn}"` : ''}`];
    }
    
    try {
      log(`Executing system shell: ${shellCommand} ${shellArgs.join(' ')}`);
      const { exitCode, result, stderr } = await this.executeCommand(shellCommand, shellArgs);
      
      log(`Shell exit code: ${exitCode}`);
      log(`Shell result length: ${result ? result.length : 0}`);
      log(`Shell stderr: ${stderr || '(none)'}`);
      
      if (exitCode !== 0) {
        log(`Shell command failed with exit code ${exitCode}`);
      } else if (result && result.length > 0) {
        log(`Shell result (first 200 chars): ${result.substring(0, 200)}...`);
        
        try {
          const parsedData = JSON.parse(result);
          log("✓ Successfully parsed JSON from shell output");
          
          if (Array.isArray(parsedData)) {
            log(`Success: Found array with ${parsedData.length} items`);
            addon.data.lastSearchResults = parsedData;
            return parsedData;
          } else if (typeof parsedData === 'object') {
            // Single object - wrap in array
            log("Success: Found single object, wrapping in array");
            const results = [parsedData];
            addon.data.lastSearchResults = results;
            return results;
          } else {
            throw new Error(`Invalid data type: ${typeof parsedData}`);
          }
        } catch (parseError) {
          log(`ERROR parsing JSON from shell output: ${String(parseError)}`);
          // Try to extract JSON objects from output
          const jsonObjects = this.extractJsonObjects(result);
          if (jsonObjects.length > 0) {
            log(`Extracted ${jsonObjects.length} JSON objects from mixed output`);
            addon.data.lastSearchResults = jsonObjects;
            return jsonObjects;
          }
        }
      } else {
        log("Shell command returned empty result");
      }
    } catch (approachError) {
      log(`Error in Approach 5: ${String(approachError)}`);
    }
    
    // If we reach here, all approaches failed
    log("\n=== ALL APPROACHES FAILED ===");
    
    // Create a user-friendly manual test command
    const manualTestCmd = `${pythonPath} ${scriptPath} --protocol ${protocol} --endpoint ${endpoint} --format json --max-records ${maxResults}${title ? ` --title "${title}"` : ''}${author ? ` --author "${author}"` : ''}${isbn ? ` --isbn "${isbn}"` : ''}`;
    
    // Show debug dialog with all the logs
    this.showDebugDialog(
      "Search Script Issue",
      "The search script could not be executed properly or its output could not be captured. Please try running the command directly in a terminal to check if it works.",
      `Manual test command:\n${manualTestCmd}\n\nDebug Logs:\n${debugLogs.join("\n")}`
    );
    
    throw new Error("Could not retrieve search results after trying multiple approaches. Please check the logs and try running the command manually.");
  }

  /**
   * Execute a command with OS command processor
   */
  static async executeCommand(command: string, args: string[]): Promise<{ exitCode: number, result: string, stderr: string }> {
    return new Promise((resolve, reject) => {
      try {
        ztoolkit.log(`Executing command: ${command} ${args.join(' ')}`);
        
        // Create file for the command
        const file = Components.classes["@mozilla.org/file/local;1"]
          .createInstance(Components.interfaces.nsIFile);
        file.initWithPath(command);
        
        // Create process
        const process = Components.classes["@mozilla.org/process/util;1"]
          .createInstance(Components.interfaces.nsIProcess);
        
        process.init(file);
        
        // Create pipes for stdout and stderr
        const stdout = Components.classes["@mozilla.org/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stdout.init(false, false, 8192, 0, null);  // Use larger buffer
        
        const stderr = Components.classes["@mozilla.org/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stderr.init(false, false, 8192, 0, null);  // Use larger buffer
        
        // Run process
        process.run(false, args, args.length, stdout.outputStream, stderr.outputStream);
        
        // Read output with continuous polling
        let stdoutData = "";
        let stderrData = "";
        let complete = false;
        
        // Function to read available data from streams
        const readAvailableData = () => {
          try {
            // Read from stdout
            if (stdout.inputStream.available() > 0) {
              const scriptableInput = Components.classes["@mozilla.org/scriptableinputstream;1"]
                .createInstance(Components.interfaces.nsIScriptableInputStream);
              scriptableInput.init(stdout.inputStream);
              
              const available = stdout.inputStream.available();
              const data = scriptableInput.read(available);
              stdoutData += data;
              
              ztoolkit.log(`Read ${data.length} bytes from stdout pipe`);
            }
            
            // Read from stderr
            if (stderr.inputStream.available() > 0) {
              const scriptableInput = Components.classes["@mozilla.org/scriptableinputstream;1"]
                .createInstance(Components.interfaces.nsIScriptableInputStream);
              scriptableInput.init(stderr.inputStream);
              
              const available = stderr.inputStream.available();
              const data = scriptableInput.read(available);
              stderrData += data;
              
              ztoolkit.log(`Read ${data.length} bytes from stderr pipe`);
            }
          } catch (e) {
            ztoolkit.log(`Error reading from pipes: ${e}`);
          }
        };
        
        // Poll for completion
        const checkInterval = setInterval(() => {
          if (complete) return;
          
          readAvailableData();
          
          if (!process.isRunning) {
            clearInterval(checkInterval);
            complete = true;
            
            // Read any remaining data
            readAvailableData();
            
            ztoolkit.log(`Process completed with exit code ${process.exitValue}`);
            ztoolkit.log(`Total stdout data: ${stdoutData.length} bytes`);
            ztoolkit.log(`Total stderr data: ${stderrData.length} bytes`);
            
            // Resolve with the results
            resolve({
              exitCode: process.exitValue,
              result: stdoutData,
              stderr: stderrData
            });
          }
        }, 100);
        
        // Set timeout to avoid hanging forever
        setTimeout(() => {
          if (!complete) {
            clearInterval(checkInterval);
            complete = true;
            
            ztoolkit.log("Process execution timed out, killing process");
            try {
              if (process.isRunning) {
                process.kill();
              }
            } catch (e) {
              ztoolkit.log(`Error killing process: ${e}`);
            }
            
            readAvailableData();
            
            resolve({
              exitCode: -1,
              result: stdoutData,
              stderr: stderrData + "\n(Process timed out after 60 seconds)"
            });
          }
        }, 60000);  // 60 second timeout
      } catch (e) {
        ztoolkit.log(`Error executing command: ${e}`);
        reject(e);
      }
    });
  }
  
/**
 * Helper method to write to a file - Fixed for TypeScript
 */
static async writeFile(path: string, content: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // Create file object
      const file = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      file.initWithPath(path);
      
      // Create output stream with an explicit any type to bypass TypeScript errors
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outStream: any = Components.classes["@mozilla.org/network/file-output-stream;1"]
        .createInstance(Components.interfaces.nsIFile);
      
      // Init with PR_WRONLY | PR_CREATE_FILE | PR_TRUNCATE, permissions 0o666
      outStream.init(file, 0x02 | 0x08 | 0x20, 0o666, 0);
      
      // Write content directly as a string
      outStream.write(content, content.length);
      outStream.close();
      
      resolve();
    } catch (e) {
      ztoolkit.log(`Error writing file ${path}: ${String(e)}`);
      reject(e);
    }
  });
}

/**
 * Helper method to read from a file - Fixed for TypeScript
 */
static async readFile(path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      // Create file object
      const file = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsIFile);
      file.initWithPath(path);
      
      if (!file.exists()) {
        reject(new Error(`File does not exist: ${path}`));
        return;
      }
      
      // Use explicit any types to bypass TypeScript interface limitations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inStream: any = Components.classes["@mozilla.org/network/file-input-stream;1"]
        .createInstance(Components.interfaces.nsIFile);
      
      // Init with PR_RDONLY, permissions 0o444
      inStream.init(file, 0x01, 0o444, 0);
      
      // Create scriptable stream for reading
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scriptableStream: any = Components.classes["@mozilla.org/scriptableinputstream;1"]
        .createInstance(Components.interfaces.nsIFile);
      scriptableStream.init(inStream);
      
      // Read the content
      const fileSize = file.fileSize;
      const data = scriptableStream.read(fileSize);
      
      // Clean up
      scriptableStream.close();
      inStream.close();
      
      resolve(data);
    } catch (e) {
      ztoolkit.log(`Error reading file ${path}: ${String(e)}`);
      reject(e);
    }
  });
}

  /**
   * Extract JSON objects from mixed text output
   */
  static extractJsonObjects(text: string): any[] {
    const objects = [];
    let depth = 0;
    let startIndex = -1;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (char === '{') {
        if (depth === 0) {
          startIndex = i;
        }
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && startIndex !== -1) {
          const jsonStr = text.substring(startIndex, i + 1);
          try {
            const obj = JSON.parse(jsonStr);
            objects.push(obj);
          } catch (e) {
            // Invalid JSON, skip
          }
          startIndex = -1;
        }
      }
    }
    
    return objects;
  }

  /**
   * Helper method to show debug info in a dialog
   */
  static showDebugDialog(title: string, message: string, debugInfo: string) {
    try {
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
            rows: 25,
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

      dialogHelper.open(title, { width: 800, height: 600 });
    } catch (e) {
      // Fallback to a less intrusive method if dialog creation fails
      if (typeof Zotero !== 'undefined' && Zotero.getMainWindow) {
        const win = Zotero.getMainWindow();
        if (win) {
          win.confirm(`${title}\n\n${message}\n\nSee console for debug information.`);
          console.error(debugInfo);
        }
      } else {
        // Last resort
        console.error(`${title}: ${message}`);
        console.error(debugInfo);
      }
    }
  }

  /**
   * Import search results into Zotero
   */
  static async importResults(records: any[]): Promise<void> {
    if (!records || records.length === 0) {
      throw new Error("No results to import");
    }
  
    ztoolkit.log(`Importing ${records.length} records into Zotero`);
  
    // Convert results to Zotero items
    const items = records.map(record => {
      // Determine item type based on format or other indicators
      let itemType = "book"; // Default
      
      if (record.format) {
        // Use format field if available
        if (record.format === "Journal Article") {
          itemType = "journalArticle";
        } else if (record.format === "Book Chapter") {
          itemType = "bookSection";
        } else if (record.format === "Book") {
          itemType = "book";
        } else if (record.format === "Thesis") {
          itemType = "thesis";
        } else if (record.format === "Conference Paper") {
          itemType = "conferencePaper";
        } else if (record.format === "Report") {
          itemType = "report";
        }
      } else {
        // Fallback determination
        if (record.journal_title || record.issn) {
          itemType = "journalArticle";
        } else if (record.series && record.pages) {
          itemType = "bookSection";
        }
      }
  
      // Format creators
      const creators = [];
  
      // Add authors
      if (record.authors && record.authors.length > 0) {
        for (const author of record.authors) {
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
      if (record.editors && record.editors.length > 0) {
        for (const editor of record.editors) {
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
  
      // Add translators
      if (record.translators && record.translators.length > 0) {
        for (const translator of record.translators) {
          let firstName = "";
          let lastName = "";
  
          if (translator.includes(",")) {
            const parts = translator.split(",", 2);
            lastName = parts[0].trim();
            firstName = parts[1] ? parts[1].trim() : "";
          } else {
            const parts = translator.split(" ");
            if (parts.length > 1) {
              lastName = parts[parts.length - 1];
              firstName = parts.slice(0, parts.length - 1).join(" ");
            } else {
              lastName = translator;
            }
          }
  
          creators.push({
            creatorType: "translator",
            firstName,
            lastName
          });
        }
      }
  
      // Create base Zotero item
      const item: any = {
        itemType,
        title: record.title,
        creators,
        date: record.year,
        // Map publisher_name to publisher field for Zotero
        publisher: record.publisher_name || record.publisher,
        place: record.place_of_publication || record.place,
        ISBN: record.isbn,
        ISSN: record.issn,
        language: record.language,
        url: record.urls && record.urls.length > 0 ? record.urls[0] : "",
        abstractNote: record.abstract,
        DOI: record.doi,
        tags: (record.subjects || []).map((subject: string) => ({ tag: subject }))
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
          // Use simpler creator method that's less prone to errors
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
  
      ztoolkit.log(`Successfully imported ${createdItems.length} items`);
  
      // Select the items in the UI
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