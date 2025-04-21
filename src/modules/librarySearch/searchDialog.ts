// src/modules/librarySearch/searchDialog.ts

import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import { ThemeUtils } from "../themeUtils";
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from "./endpoints";
import { LibrarySearchIntegration } from "./integration";

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
 * Creates and opens the search dialog
 */
export async function openSearchDialog(): Promise<void> {
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
      ztoolkit.log("Previous dialog reference was invalid, creating new one");
    }

    // Reset dialog reference
    addon.data.dialog = undefined;
  }

  // Define a more complete interface for dialogData
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
    loadCallback?: Function;
    unloadCallback?: Function;
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

  // Load callback to initialize protocol/endpoint selection
  dialogData.loadCallback = function() {
    if (dialogHelper.window) {
      // Get the document
      const doc = dialogHelper.window.document;

      // Set up protocol radios
      const protocolRadios = doc.querySelectorAll('input[name="protocol"]');
      for (const radio of protocolRadios) {
        radio.addEventListener('change', function(e: Event) {
          const target = e.target as HTMLInputElement;
          if (target.checked) {
            dialogData.protocol = target.value;
            updateEndpointDropdown(target.value, doc);
          }
        });
      }

      // Initial endpoint setup based on default protocol
      updateEndpointDropdown(dialogData.protocol, doc);
    }
  };

  // Unload callback to clean up references
  dialogData.unloadCallback = function() {
    // Clear the dialog reference when it's closed
    addon.data.dialog = undefined;
    ztoolkit.log("Dialog closed and reference cleared");
  };

  // Create the dialog helper
  const dialogHelper = createStyledDialog(10, 2)
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

    // Protocol selection (radio buttons for better UX)
    .addCell(2, 0, {
      tag: "label",
      namespace: "html",
      properties: {
        textContent: getString("search-dialog-protocol"),
      },
    })
    .addCell(2, 1, {
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
              }
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
              }
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
              }
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

    // Endpoint selection
    .addCell(3, 0, {
      tag: "label",
      namespace: "html",
      properties: {
        textContent: getString("search-dialog-endpoint"),
      },
    })
    .addCell(3, 1, {
      tag: "select",
      namespace: "html",
      id: "endpoint-select",
      styles: { width: "100%" },
      listeners: [{
        type: "change",
        listener: function(e: Event) {
          dialogData.endpoint = (e.target as HTMLSelectElement).value;
        }
      }]
    })

    // Title
    .addCell(4, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "title" },
      properties: { innerHTML: getString("search-dialog-title-field") },
    })
    .addCell(4, 1, {
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
    .addCell(5, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "author" },
      properties: { innerHTML: getString("search-dialog-author") },
    })
    .addCell(5, 1, {
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
    .addCell(6, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "isbn" },
      properties: { innerHTML: getString("search-dialog-isbn") },
    })
    .addCell(6, 1, {
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
    .addCell(7, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "maxResults" },
      properties: { innerHTML: getString("search-dialog-max-results") },
    })
    .addCell(7, 1, {
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

    // Debug option
    .addCell(8, 0, {
      tag: "div",
      styles: { gridColumn: "1 / span 2" },
      children: [
        {
          tag: "div",
          styles: { display: "flex", alignItems: "center", gap: "5px", marginTop: "10px" },
          children: [
            {
              tag: "input",
              namespace: "html",
              id: "debug-mode",
              attributes: {
                type: "checkbox",
                checked: getPref("debugMode") ? "checked" : undefined
              },
              listeners: [
                {
                  type: "change",
                  listener: (e: Event) => {
                    setPref("debugMode", (e.target as HTMLInputElement).checked);
                  }
                }
              ]
            },
            {
              tag: "label",
              namespace: "html",
              attributes: { for: "debug-mode" },
              properties: { innerHTML: "Enable debug mode" }
            }
          ]
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

        // Get the current values from UI elements
        if (dialogHelper.window) {
          const doc = dialogHelper.window.document;

          // Get protocol
          const selectedProtocolEl = doc.querySelector('input[name="protocol"]:checked') as HTMLInputElement;
          if (selectedProtocolEl) {
            dialogData.protocol = selectedProtocolEl.value;
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
          searchButton.textContent = getString("search-dialog-searching");
        }

        try {
          ztoolkit.log("Search parameters:", {
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
            // Store results for reference
            addon.data.lastSearchResults = results;

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

  // Open the dialog and store reference
  dialogHelper.open(getString("search-dialog-title"));
  addon.data.dialog = dialogHelper;
}

/**
 * Updates the endpoint dropdown based on the selected protocol
 */
function updateEndpointDropdown(protocol: string, doc: Document): void {
  try {
    const endpointSelect = doc.getElementById("endpoint-select") as HTMLSelectElement;
    if (!endpointSelect) {
      ztoolkit.log("Could not find endpoint select element");
      return;
    }

    // Clear existing options
    while (endpointSelect.firstChild) {
      endpointSelect.removeChild(endpointSelect.firstChild);
    }

    // Add options based on protocol
    let endpoints: Record<string, any> = {};
    let defaultValue = "";

    switch(protocol) {
      case "sru":
        endpoints = SRU_ENDPOINTS;
        defaultValue = "dnb";
        break;
      case "oai":
        endpoints = OAI_ENDPOINTS;
        defaultValue = "crossref";
        break;
      case "ixtheo":
        endpoints = IXTHEO_ENDPOINTS;
        defaultValue = "ris";
        break;
      default:
        endpoints = SRU_ENDPOINTS;
        defaultValue = "dnb";
    }

    // Add options
    for (const [key, value] of Object.entries(endpoints)) {
      const option = doc.createElement('option');
      option.value = key;
      option.textContent = value.name || key;
      endpointSelect.appendChild(option);
    }

    // Set default value
    endpointSelect.value = defaultValue;

    ztoolkit.log(`Updated endpoint dropdown for protocol ${protocol} with ${Object.keys(endpoints).length} options`);
  } catch (e) {
    ztoolkit.log(`Error updating endpoint dropdown: ${e}`);
  }
}