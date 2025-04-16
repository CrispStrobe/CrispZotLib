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
    loadCallback: (window: Window) => {
      ztoolkit.log("Search dialog opened");
      
      // Apply theme to the dialog
      ThemeUtils.applyTheme(window);
      
      // Apply styling with proper null checks
      if (window.document) {
        const doc = window.document;
        
        if (doc.body) {
          // Add dialog class
          doc.body.classList.add('librarysearch-dialog');
          
          // Create container
          const container = doc.createElement('div');
          container.className = 'dialog-container';
          
          // Move content to container - with proper null checking
          const childNodes = Array.from(doc.body.childNodes);
          for (const node of childNodes) {
            if (node) {
              container.appendChild(node);
            }
          }
          
          doc.body.appendChild(container);
          
          // Style header
          const h1 = doc.querySelector('h1');
          if (h1 && h1.parentNode) {
            const header = doc.createElement('div');
            header.className = 'dialog-header';
            h1.parentNode.insertBefore(header, h1);
            header.appendChild(h1);
          }
          
          // Style buttons
          const buttons = doc.querySelectorAll('button');
          if (buttons.length > 0) {
            const buttonContainer = doc.createElement('div');
            buttonContainer.className = 'button-container';
            container.appendChild(buttonContainer);
            
            Array.from(buttons).forEach(btn => {
              const button = btn as HTMLButtonElement;
              if (button.parentNode) {
                button.parentNode.removeChild(button);
              }
              
              // Add primary class to action buttons
              if (button.id === 'search' || 
                  (button.textContent && button.textContent.includes('Search'))) {
                button.classList.add('primary');
              }
              
              buttonContainer.appendChild(button);
            });
          }
        } else if (doc.documentElement) {
          // Fallback if body isn't available
          doc.documentElement.classList.add('librarysearch-dialog');
        }
      }
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
    // For the title field:
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
      listeners: [
        {
          type: "input", // Use input event to catch changes in real-time
          listener: (e) => {
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
      listeners: [
        {
          type: "input", // Use input event to catch changes in real-time
          listener: (e) => {
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
        "data-bind": "maxResults",
        "data-prop": "value"
      },
      styles: { width: "100px" },
      listeners: [
        {
          type: "input", // Use input event to catch changes in real-time
          listener: (e) => {
            dialogData.maxResults = (e.target as HTMLInputElement).value;
          }
        }
      ]
    })

    // Add buttons
    .addButton(getString("search-dialog-search-button"), "search", {
      callback: async (e) => {
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
      
        // Get all form values directly from the UI elements
        if (dialogHelper.window) {
          const doc = dialogHelper.window.document;
          if (doc) {
            // Update all input fields from the UI to dialogData
            const fields = ['pythonPath', 'scriptPath', 'protocol', 'endpoint', 'title', 'author', 'isbn', 'maxResults'];
            for (const field of fields) {
              const elem = doc.getElementById(field) as HTMLInputElement | HTMLSelectElement;
              if (elem) {
                dialogData[field] = elem.value;
                ztoolkit.log(`Updated ${field} from UI: ${elem.value}`);
              }
            }
          }
        }
      
        // Log the dialog data for debugging
        ztoolkit.log("Search parameters from dialog:", JSON.stringify(dialogData, null, 2));
      
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
      
        // Ensure we get a fresh copy of the data from the UI
        try {
          // Get the updated values directly from the input fields
          const pythonPathInput = dialogHelper.window?.document?.getElementById('pythonPath') as HTMLInputElement;
          const scriptPathInput = dialogHelper.window?.document?.getElementById('scriptPath') as HTMLInputElement;
          
          if (pythonPathInput && pythonPathInput.value.trim()) {
            dialogData.pythonPath = pythonPathInput.value.trim();
          }
          
          if (scriptPathInput && scriptPathInput.value.trim()) {
            dialogData.scriptPath = scriptPathInput.value.trim();
          }
          
          ztoolkit.log("Updated paths from UI:", {
            pythonPath: dialogData.pythonPath,
            scriptPath: dialogData.scriptPath
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
      
          // Run the search with more detailed error handling
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
          if (dialogData.errorMessage && dialogHelper.window) {
            dialogHelper.window.alert(dialogData.errorMessage);
          }
        }
      },
      noClose: true
    })
    .addButton(getString("search-dialog-cancel-button"), "cancel")
    .setDialogData(dialogData);
  
  // Open the dialog
  dialogHelper.open(getString("search-dialog-title"));
  
  addon.data.dialog = dialogHelper;
}

  
/**
 * Opens a dialog to display search results with proper styling
 */
static async openResultsDialog(results: any[]) {
  // Create dialog data
  const dialogData: { [key: string | number]: any } = {
    searchResults: results,
    selectedResults: [],
    loadCallback: (window: Window) => {
      ztoolkit.log("Results dialog opened");
      
      // Apply theme and styling
      ThemeUtils.applyTheme(window);
      
      // Apply styling with proper null checks
      if (window.document) {
        const doc = window.document;
        
        if (doc.body) {
          // Add dialog class
          doc.body.classList.add('librarysearch-dialog');
          doc.body.classList.add('results-dialog');
          
          // Create container
          const container = doc.createElement('div');
          container.className = 'dialog-container';
          
          // Move content to container - with proper null checking
          const childNodes = Array.from(doc.body.childNodes);
          for (const node of childNodes) {
            if (node) {
              container.appendChild(node);
            }
          }
          
          doc.body.appendChild(container);
          
          // Style header
          const h1 = doc.querySelector('h1');
          if (h1 && h1.parentNode) {
            const header = doc.createElement('div');
            header.className = 'dialog-header';
            h1.parentNode.insertBefore(header, h1);
            header.appendChild(h1);
          }
          
          // Style results container
          const resultsElem = doc.querySelector('.results-container');
          if (!resultsElem) {
            const resultsDiv = doc.createElement('div');
            resultsDiv.className = 'results-container';
            
            // Find all result items and move them to container
            const resultItems = doc.querySelectorAll('.result-item');
            if (resultItems.length > 0) {
              resultItems.forEach((item: Element) => {
                if (item.parentNode) {
                  item.parentNode.removeChild(item);
                }
                resultsDiv.appendChild(item);
              });
              
              // Add to main container
              container.appendChild(resultsDiv);
            }
          }
          
          // Style buttons
          const buttons = doc.querySelectorAll('button');
          if (buttons.length > 0) {
            const buttonContainer = doc.createElement('div');
            buttonContainer.className = 'button-container';
            container.appendChild(buttonContainer);
            
            Array.from(buttons).forEach(btn => {
              const button = btn as HTMLButtonElement;
              if (button.parentNode) {
                button.parentNode.removeChild(button);
              }
              
              // Add primary class to action buttons
              if (button.id === 'import' || button.id === 'importAll') {
                button.classList.add('primary');
              }
              
              buttonContainer.appendChild(button);
            });
          }
        } else if (doc.documentElement) {
          // Fallback if body isn't available
          doc.documentElement.classList.add('librarysearch-dialog');
        }
      }
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

  /**
   * Runs a search using the library_search.py script
   */
  static async runSearch(searchParams: any): Promise<any[]> {
    const { pythonPath, scriptPath, protocol, endpoint, title, author, isbn, maxResults } = searchParams;
    
    // Existing validation code...
    
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
    
    // Log the full command for debugging
    ztoolkit.log("Executing search command:", pythonPath, args.join(' '));
    
    try {
      const { exitCode, result, stderr } = await LibrarySearchModule.executeCommand(pythonPath, args);
      
      // Log the raw output for debugging
      ztoolkit.log("Command exit code:", exitCode);
      ztoolkit.log("Raw command output:", result);
      if (stderr) {
        ztoolkit.log("Command stderr:", stderr);
      }
      
      if (exitCode !== 0) {
        ztoolkit.log("Search script error:", stderr);
        throw new Error(getString("search-error-script-failed") + ": " + stderr);
      }
      
      // Trim and log the JSON content
      const trimmedResult = result.trim();
      ztoolkit.log("Trimmed result:", trimmedResult);
      
      try {
        // Try to parse as JSON
        const results = JSON.parse(trimmedResult);
        
        // Validate the structure
        if (!Array.isArray(results)) {
          ztoolkit.log("Results are not an array:", results);
          throw new Error(getString("search-error-invalid-results") + ": Results are not an array");
        }
        
        // Log each result's structure
        results.forEach((item, index) => {
          ztoolkit.log(`Result ${index} structure:`, JSON.stringify(item, null, 2));
        });
        
        ztoolkit.log(`Found ${results.length} results`);
        addon.data.lastSearchResults = results;
        return results;
      } catch (e) {
        ztoolkit.log("Error parsing JSON results:", e);
        
        // Try to show part of the raw result to help debugging
        const preview = result.length > 200 ? result.substring(0, 200) + "..." : result;
        throw new Error(getString("search-error-invalid-results") + 
                       `\n\nParser error: ${e}\n\nPreview: ${preview}`);
      }
    } catch (error) {
      ztoolkit.log("Command execution error:", error);
      throw error;
    }
  }

  /**
   * Execute a command with the OS command processor
   * @param command Command to execute
   * @param args Arguments for the command
   * @returns Promise resolving to execution result
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
        
        // If the command is a non-absolute path like 'which' or 'where', use special handling
        if (!command.includes('/') && !command.includes('\\')) {
          // For system commands without a path, create a temporary shell script
          if (Zotero.isWin) {
            // Windows - use cmd.exe
            file.initWithPath('C:\\Windows\\System32\\cmd.exe');
            // Prepend /c to run the command and exit
            args = ['/c', command, ...args];
            command = 'C:\\Windows\\System32\\cmd.exe';
          } else {
            // Unix - use /bin/sh
            file.initWithPath('/bin/sh');
            // Create command string with arguments
            const cmdString = `${command} ${args.join(' ')}`;
            args = ['-c', cmdString];
            command = '/bin/sh';
          }
        } else {
          // Normal case - direct command with path
          file.initWithPath(command);
        }
        
        process.init(file);

        // Create pipes for stdout and stderr
        const stdout = Components.classes["@mozilla.org/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stdout.init(false, false, 0, 0, null);

        const stderr = Components.classes["@mozilla.org/pipe;1"]
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