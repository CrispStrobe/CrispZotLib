// src/modules/librarySearch/searchDialog.ts

import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import { ThemeUtils } from "../themeUtils";
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from "./endpoints";
import { LibrarySearchIntegration, SearchParams } from "./integration";

/**
 * Enhanced dialog creation with proper styling
 * @param rows Number of rows
 * @param cols Number of columns
 * @returns Dialog helper with enhanced styling
 */
export function createStyledDialog(rows: number, cols: number): any {
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
    schema: string;
    title: string;
    author: string;
    isbn: string;
    allFieldsTerm: string; 
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
    schema: "", // Empty schema means use endpoint default
    title: "",
    author: "",
    isbn: "",
    allFieldsTerm: "",
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

      // --- Helper function to enable/disable All Fields input ---
      // (Defined once to avoid repetition)
      const updateAllFieldsInputState = (protocol: string, documentContext: Document) => {
          const allFieldsInput = documentContext.getElementById("all-fields-term") as HTMLInputElement | null;
          const allFieldsLabel = documentContext.querySelector('label[for="all-fields-term"]') as HTMLLabelElement | null;
          const allFieldsRow = documentContext.getElementById("all-fields-row") as HTMLElement | null; // Cast

          if (allFieldsInput && allFieldsLabel && allFieldsRow) {
              if (protocol === "oai") {
                  allFieldsInput.disabled = true;
                  allFieldsInput.value = ""; // Clear value when disabled
                  dialogData.allFieldsTerm = ""; // Clear data model value
                  allFieldsRow.setAttribute('title', getString("search-dialog-allfields-disabled-oai-tooltip")); // Add tooltip
                  if (allFieldsLabel) allFieldsLabel.style.opacity = '0.5';
              } else {
                  allFieldsInput.disabled = false;
                  allFieldsRow.removeAttribute('title'); // Remove tooltip
                  if (allFieldsLabel) allFieldsLabel.style.opacity = '1';
              }
          }
      };
      // --- End Helper ---


      // Set up protocol radios
      const protocolRadios = doc.querySelectorAll('input[name="protocol"]');
      for (const radio of protocolRadios) {
        radio.addEventListener('change', function(e: Event) {
          const target = e.target as HTMLInputElement;
          if (target.checked) {
            const newProtocol = target.value; // Store the new protocol
            dialogData.protocol = newProtocol;

            // Show/hide relevant endpoint selects (with casting)
            if (doc) {
              const sruSelect = doc.getElementById("endpoint-sru") as HTMLElement | null; // Cast
              const oaiSelect = doc.getElementById("endpoint-oai") as HTMLElement | null; // Cast
              const ixtheoSelect = doc.getElementById("endpoint-ixtheo") as HTMLElement | null; // Cast

              // Default state (adjust based on newProtocol)
              if (sruSelect) sruSelect.style.display = "none";
              if (oaiSelect) oaiSelect.style.display = "none";
              if (ixtheoSelect) ixtheoSelect.style.display = "none";

              // Show/hide schema options (with casting)
              const schemaRow = doc.getElementById("schema-row") as HTMLElement | null; // Cast

              if (newProtocol === "sru") {
                if (sruSelect) {
                  sruSelect.style.display = "block";
                  dialogData.endpoint = (sruSelect as HTMLSelectElement).value;
                }
                if (schemaRow) schemaRow.style.display = "block";
              }
              else if (newProtocol === "oai") {
                if (oaiSelect) {
                  oaiSelect.style.display = "block";
                  dialogData.endpoint = (oaiSelect as HTMLSelectElement).value;
                }
                if (schemaRow) schemaRow.style.display = "none";
                dialogData.schema = ""; // Clear schema for non-SRU
              }
              else if (newProtocol === "ixtheo") {
                if (ixtheoSelect) {
                  ixtheoSelect.style.display = "block";
                  dialogData.endpoint = (ixtheoSelect as HTMLSelectElement).value;
                }
                if (schemaRow) schemaRow.style.display = "none";
                dialogData.schema = ""; // Clear schema for non-SRU
              }

              // --- ADDED: Update All Fields input state on change ---
              updateAllFieldsInputState(newProtocol, doc);
              // --- END ADDED ---
            }
          }
        });
      }

      // Set initial visibility based on default protocol (with casting)
      const schemaRow = doc.getElementById("schema-row") as HTMLElement | null; // Cast
      if (schemaRow) {
        schemaRow.style.display = dialogData.protocol === "sru" ? "block" : "none";
      }

      // Show the correct endpoint select based on protocol (with casting)
      const sruSelect = doc.getElementById("endpoint-sru") as HTMLElement | null; // Cast
      const oaiSelect = doc.getElementById("endpoint-oai") as HTMLElement | null; // Cast
      const ixtheoSelect = doc.getElementById("endpoint-ixtheo") as HTMLElement | null; // Cast

      if (sruSelect) sruSelect.style.display = dialogData.protocol === "sru" ? "block" : "none";
      if (oaiSelect) oaiSelect.style.display = dialogData.protocol === "oai" ? "block" : "none";
      if (ixtheoSelect) ixtheoSelect.style.display = dialogData.protocol === "ixtheo" ? "block" : "none";

      // --- ADDED: Set initial state for All Fields input ---
      updateAllFieldsInputState(dialogData.protocol, doc);
      // --- END ADDED ---
    }
  };

  // Unload callback to clean up references
  dialogData.unloadCallback = function() {
    // Clear the dialog reference when it's closed
    addon.data.dialog = undefined;
    ztoolkit.log("Dialog closed and reference cleared");
  };

  // Create the dialog helper - adding an extra row for schema options
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
                checked: dialogData.protocol === "sru" ? "checked" : undefined
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
                value: "oai",
                checked: dialogData.protocol === "oai" ? "checked" : undefined
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
                value: "ixtheo",
                checked: dialogData.protocol === "ixtheo" ? "checked" : undefined
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

    // Endpoint selection - using three different selects
    .addCell(3, 0, {
      tag: "label",
      namespace: "html",
      properties: {
        textContent: getString("search-dialog-endpoint"),
      },
    })
    .addCell(3, 1, {
      tag: "div",
      namespace: "html",
      children: [
        // SRU Endpoints
        {
          tag: "select",
          namespace: "html",
          id: "endpoint-sru",
          styles: { 
            width: "100%", 
            display: dialogData.protocol === "sru" ? "block" : "none" 
          },
          listeners: [{
            type: "change",
            listener: function(e: Event) {
              dialogData.endpoint = (e.target as HTMLSelectElement).value;
            }
          }],
          children: [
            {
              tag: "option",
              namespace: "html",
              properties: { value: "dnb", innerHTML: "dnb", selected: dialogData.endpoint === "dnb" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "bnf", innerHTML: "bnf", selected: dialogData.endpoint === "bnf" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "zdb", innerHTML: "zdb", selected: dialogData.endpoint === "zdb" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "loc", innerHTML: "loc", selected: dialogData.endpoint === "loc" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "trove", innerHTML: "trove", selected: dialogData.endpoint === "trove" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "kb", innerHTML: "kb", selected: dialogData.endpoint === "kb" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "bibsys", innerHTML: "bibsys", selected: dialogData.endpoint === "bibsys" }
            }
          ]
        },
        // OAI Endpoints
        {
          tag: "select",
          namespace: "html",
          id: "endpoint-oai",
          styles: { 
            width: "100%", 
            display: dialogData.protocol === "oai" ? "block" : "none" 
          },
          listeners: [{
            type: "change",
            listener: function(e: Event) {
              dialogData.endpoint = (e.target as HTMLSelectElement).value;
            }
          }],
          children: [
            {
              tag: "option",
              namespace: "html",
              properties: { value: "crossref", innerHTML: "crossref", selected: true }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "dnb", innerHTML: "dnb" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "dnb_digital", innerHTML: "dnb_digital" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "loc", innerHTML: "loc" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "europeana", innerHTML: "europeana" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "ddb", innerHTML: "ddb" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "harvard", innerHTML: "harvard" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "mit", innerHTML: "mit" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "kitopen", innerHTML: "kitopen" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "arxiv", innerHTML: "arxiv" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "doaj", innerHTML: "doaj" }
            }
          ]
        },
        // IxTheo Endpoints
        {
          tag: "select",
          namespace: "html",
          id: "endpoint-ixtheo",
          styles: { 
            width: "100%", 
            display: dialogData.protocol === "ixtheo" ? "block" : "none" 
          },
          listeners: [{
            type: "change",
            listener: function(e: Event) {
              dialogData.endpoint = (e.target as HTMLSelectElement).value;
            }
          }],
          children: [
            {
              tag: "option",
              namespace: "html",
              properties: { value: "ris", innerHTML: "ris", selected: true }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "marc", innerHTML: "marc" }
            },
            {
              tag: "option",
              namespace: "html",
              properties: { value: "html", innerHTML: "html" }
            }
          ]
        }
      ]
    })
    
    // Schema selection (radio buttons, only visible for SRU)
    .addCell(4, 0, {
      tag: "div",
      id: "schema-row",
      styles: { 
        gridColumn: "1 / span 2", 
        display: dialogData.protocol === "sru" ? "block" : "none" 
      },
      children: [
        {
          tag: "div",
          styles: { marginBottom: "10px" },
          children: [
            {
              tag: "label",
              namespace: "html",
              styles: { display: "block", marginBottom: "5px" },
              properties: { textContent: "Schema Format:" }
            },
            {
              tag: "div",
              namespace: "html",
              styles: { display: "flex", flexWrap: "wrap", gap: "10px" },
              children: [
                // Default (empty) schema option
                {
                  tag: "div",
                  styles: { display: "flex", alignItems: "center", gap: "5px" },
                  children: [
                    {
                      tag: "input",
                      namespace: "html",
                      id: "schema-default",
                      attributes: {
                        type: "radio",
                        name: "schema",
                        value: "",
                        checked: "checked"
                      },
                      listeners: [
                        {
                          type: "change",
                          listener: (e: Event) => {
                            if ((e.target as HTMLInputElement).checked) {
                              dialogData.schema = "";
                            }
                          }
                        }
                      ]
                    },
                    {
                      tag: "label",
                      namespace: "html",
                      attributes: { for: "schema-default" },
                      properties: { innerHTML: "Endpoint Default" }
                    }
                  ]
                },
                // MARCXML schema option
                {
                  tag: "div",
                  styles: { display: "flex", alignItems: "center", gap: "5px" },
                  children: [
                    {
                      tag: "input",
                      namespace: "html",
                      id: "schema-marcxml",
                      attributes: {
                        type: "radio",
                        name: "schema",
                        value: "marcxml"
                      },
                      listeners: [
                        {
                          type: "change",
                          listener: (e: Event) => {
                            if ((e.target as HTMLInputElement).checked) {
                              dialogData.schema = "marcxml";
                            }
                          }
                        }
                      ]
                    },
                    {
                      tag: "label",
                      namespace: "html",
                      attributes: { for: "schema-marcxml" },
                      properties: { innerHTML: "MARCXML" }
                    }
                  ]
                },
                // DC schema option
                {
                  tag: "div",
                  styles: { display: "flex", alignItems: "center", gap: "5px" },
                  children: [
                    {
                      tag: "input",
                      namespace: "html",
                      id: "schema-dc",
                      attributes: {
                        type: "radio",
                        name: "schema",
                        value: "dc"
                      },
                      listeners: [
                        {
                          type: "change",
                          listener: (e: Event) => {
                            if ((e.target as HTMLInputElement).checked) {
                              dialogData.schema = "dc";
                            }
                          }
                        }
                      ]
                    },
                    {
                      tag: "label",
                      namespace: "html",
                      attributes: { for: "schema-dc" },
                      properties: { innerHTML: "Dublin Core" }
                    }
                  ]
                },
                // RDF/XML schema option
                {
                  tag: "div",
                  styles: { display: "flex", alignItems: "center", gap: "5px" },
                  children: [
                    {
                      tag: "input",
                      namespace: "html",
                      id: "schema-rdfxml",
                      attributes: {
                        type: "radio",
                        name: "schema",
                        value: "RDFxml"
                      },
                      listeners: [
                        {
                          type: "change",
                          listener: (e: Event) => {
                            if ((e.target as HTMLInputElement).checked) {
                              dialogData.schema = "RDFxml";
                            }
                          }
                        }
                      ]
                    },
                    {
                      tag: "label",
                      namespace: "html",
                      attributes: { for: "schema-rdfxml" },
                      properties: { innerHTML: "RDF/XML" }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })

    // --- ADDED: All Fields Input (Row 5) ---
    .addCell(5, 0, {
      tag: "div", // Wrap label and input for tooltip positioning
      id: "all-fields-row",
      styles: { gridColumn: "1 / span 2", display: 'flex', alignItems: 'center' }, // Use flex for alignment
      children: [
          {
              tag: "label", namespace: "html", attributes: { for: "all-fields-term" },
              properties: { innerHTML: getString("search-dialog-allfields") },
              styles: { marginRight: '5px', width: '100px' } // Adjust width as needed
          },
          {
              tag: "input", namespace: "html", id: "all-fields-term",
              attributes: { type: "text", value: dialogData.allFieldsTerm },
              styles: { flexGrow: 1 }, // Allow input to take remaining space
              listeners: [ { type: "input", listener: (e: Event) => { dialogData.allFieldsTerm = (e.target as HTMLInputElement).value; } } ]
          }
      ]
  })

    // Title
    .addCell(6, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "title" },
      properties: { innerHTML: getString("search-dialog-title-field") },
    })
    .addCell(6, 1, {
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
    .addCell(7, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "author" },
      properties: { innerHTML: getString("search-dialog-author") },
    })
    .addCell(7, 1, {
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
    .addCell(8, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "isbn" },
      properties: { innerHTML: getString("search-dialog-isbn") },
    })
    .addCell(8, 1, {
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
    .addCell(9, 0, {
      tag: "label",
      namespace: "html",
      attributes: { for: "maxResults" },
      properties: { innerHTML: getString("search-dialog-max-results") },
    })
    .addCell(9, 1, {
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
        { type: "input", listener: (e: Event) => {
            const input = e.target as HTMLInputElement;
            const value = parseInt(input.value, 10);
            // Update data only if it's a valid positive number, otherwise keep previous valid value or default
            if (!isNaN(value) && value > 0) {
                dialogData.maxResults = value;
            } else {
                // Optionally reset input value to the last valid data model value if input is invalid
                // input.value = String(dialogData.maxResults);
            }
        }}
      ]
    })

    // Debug option
    .addCell(10, 0, {
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

          // Get protocol from radio buttons
          const selectedProtocolEl = doc.querySelector('input[name="protocol"]:checked') as HTMLInputElement;
          if (selectedProtocolEl) {
            dialogData.protocol = selectedProtocolEl.value;
            
            // Get endpoint from the corresponding select
            const endpointSelect = doc.getElementById(`endpoint-${dialogData.protocol}`) as HTMLSelectElement;
            if (endpointSelect) {
              dialogData.endpoint = endpointSelect.value;
            }
          }

          // Get schema if SRU protocol
          if (dialogData.protocol === 'sru') {
            const selectedSchemaEl = doc.querySelector('input[name="schema"]:checked') as HTMLInputElement;
            if (selectedSchemaEl) {
              dialogData.schema = selectedSchemaEl.value;
            }
          } else {
            // Clear schema for non-SRU protocols
            dialogData.schema = "";
          }

          // Get other fields
          const titleInput = doc.getElementById('title') as HTMLInputElement;
          if (titleInput) dialogData.title = titleInput.value;

          const authorInput = doc.getElementById('author') as HTMLInputElement;
          if (authorInput) dialogData.author = authorInput.value;

          const isbnInput = doc.getElementById('isbn') as HTMLInputElement;
          if (isbnInput) dialogData.isbn = isbnInput.value;

          // --- Ensure maxResults is read and validated ---
          const maxResultsInput = doc.getElementById('maxResults') as HTMLInputElement | null;
          let parsedMaxResults = dialogData.maxResults; // Start with current data model value (which has a default)
          if (maxResultsInput) {
              const parsed = parseInt(maxResultsInput.value, 10);
              if (!isNaN(parsed) && parsed > 0) {
                  parsedMaxResults = parsed; // Use valid parsed value
              }
              // If invalid, parsedMaxResults retains the previous valid value from dialogData
          }
          dialogData.maxResults = parsedMaxResults; // Update data model definitively
          // --- End Ensure ---
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
            schema: dialogData.schema,
            title: dialogData.title,
            author: dialogData.author,
            isbn: dialogData.isbn,
            allFieldsTerm: dialogData.allFieldsTerm,
            maxResults: dialogData.maxResults
          });

          const searchParams: import('./integration').SearchParams = {
            protocol: dialogData.protocol,
            endpoint: dialogData.endpoint,
            schema: dialogData.schema,
            title: dialogData.title,
            author: dialogData.author,
            isbn: dialogData.isbn,
            allFieldsTerm: dialogData.allFieldsTerm,
            maxRecords: dialogData.maxResults
          };

          // Run the search
          const [success, results, totalRecords] = await LibrarySearchIntegration.executeSearch(searchParams);

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

            // Open results dialog with needed parameters for pagination
            await LibrarySearchIntegration.openResultsDialog(results, totalRecords, searchParams);
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