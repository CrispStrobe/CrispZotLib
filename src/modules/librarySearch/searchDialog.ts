// src/modules/librarySearch/searchDialog.ts

// Imports remain the same as your corrected version
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import { ThemeUtils } from "../themeUtils";
import { OAIClient } from "./oaiClient";
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from "./endpoints";
import { SRUEndpoint, OAIEndpoint, IxTheoEndpoint } from "./models";
import { LibrarySearchIntegration, SearchParams } from "./integration";


/**
 * Enhanced dialog creation with proper styling
 * NOTE: Keep this function as is for styling consistency.
 */
export function createStyledDialog(rows: number, cols: number): any {
  const dialogHelper: any = new ztoolkit.Dialog(rows, cols);
  const originalOpen = dialogHelper.open;

  dialogHelper.open = function(title: string, windowFeatures?: any) {
    const result = originalOpen.call(this, title, windowFeatures);
    try {
      if (result && result.window) {
        const win = result.window;
        if (win.document) {
          ThemeUtils.applyTheme(win);
          const doc = win.document;
          if (doc.body) {
            doc.body.classList.add('librarysearch-dialog');
            const container = doc.createElement('div');
            container.className = 'dialog-container';
            while (doc.body.childNodes.length > 0) {
              container.appendChild(doc.body.childNodes[0]);
            }
            doc.body.appendChild(container);

            const h1Elements = doc.getElementsByTagName('h1');
            if (h1Elements.length > 0 && h1Elements[0].parentNode) {
              const headerDiv = doc.createElement('div');
              headerDiv.className = 'dialog-header';
              if (h1Elements[0].parentNode) {
                h1Elements[0].parentNode.insertBefore(headerDiv, h1Elements[0]);
                headerDiv.appendChild(h1Elements[0]);
              }
            }

            const buttons = doc.querySelectorAll('button');
            if (buttons.length > 0) {
              let buttonContainer = doc.querySelector('.button-container');
              if (!buttonContainer) {
                buttonContainer = doc.createElement('div');
                buttonContainer.className = 'button-container';
                container.appendChild(buttonContainer);
                for (let i = 0; i < buttons.length; i++) {
                  const button = buttons[i] as HTMLButtonElement;
                  if (button.parentNode && button.parentNode !== buttonContainer) {
                     button.parentNode.removeChild(button);
                  }
                  if (button.id === 'search' || button.id === 'import' || button.id === 'importAll' ||
                      (button.textContent && button.textContent.includes(getString("search-dialog-search-button")))) {
                    button.classList.add('primary');
                  }
                  if (button.parentNode !== buttonContainer) {
                     buttonContainer.appendChild(button);
                  }
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
  // Keep window focus/reuse logic
  if (addon.data.dialog?.window) {
    try {
      if (!addon.data.dialog.window.closed) {
        addon.data.dialog.window.focus();
        return;
      }
    } catch (e) {
      ztoolkit.log("Previous dialog reference was invalid, creating new one");
    }
    addon.data.dialog = undefined;
  }

  // Define dialog data interface
  interface LibrarySearchDialogData {
    protocol: string;
    endpoint: string;
    schema: string;
    oaiSet?: string;
    oaiPrefix?: string;
    oaiFrom?: string;
    oaiUntil?: string;
    title: string;
    author: string;
    isbn: string;
    allFieldsTerm: string;
    maxResults: number;
    searching: boolean;
    searchComplete: boolean;
    errorMessage: string;
    unloadCallback?: () => void;
  }

  // Initialize dialog data
  const dialogData: LibrarySearchDialogData = {
    protocol: "sru",
    endpoint: "dnb",
    schema: "",
    oaiSet: '',
    oaiPrefix: 'oai_dc',
    oaiFrom: '',
    oaiUntil: '',
    title: "",
    author: "",
    isbn: "",
    allFieldsTerm: "",
    maxResults: 10,
    searching: false,
    searchComplete: false,
    errorMessage: ""
  };

  // Unload callback
  dialogData.unloadCallback = function() {
    addon.data.dialog = undefined;
    ztoolkit.log("Dialog closed and reference cleared");
  };

  // DIALOG LAYOUT
  const dialogHelper = createStyledDialog(12, 2)
    // Rows 0-5 (Protocol, Endpoint, Schema, OAI Options) - Unchanged
    .addCell(0, 0, { tag: "h1", namespace: "html", properties: { innerHTML: getString("search-dialog-title") }, styles: { gridColumn: "1 / span 2" } })
    .addCell(1, 0, { tag: "div", namespace: "html", styles: { gridColumn: "1 / span 2" }, properties: { innerHTML: getString("search-dialog-description") } })
    .addCell(2, 0, { tag: "label", namespace: "html", properties: { textContent: getString("search-dialog-protocol") } })
    .addCell(2, 1, { tag: "div", namespace: "html", styles: { display: "flex", gap: "10px" }, children: [
        { tag: "div", styles: { display: "flex", alignItems: "center", gap: "5px" }, children: [ { tag: "input", namespace: "html", id: "protocol-sru", attributes: { type: "radio", name: "protocol", value: "sru", checked: dialogData.protocol === "sru" ? "checked" : undefined } }, { tag: "label", namespace: "html", attributes: { for: "protocol-sru" }, properties: { innerHTML: "SRU" } } ] },
        { tag: "div", styles: { display: "flex", alignItems: "center", gap: "5px" }, children: [ { tag: "input", namespace: "html", id: "protocol-oai", attributes: { type: "radio", name: "protocol", value: "oai", checked: dialogData.protocol === "oai" ? "checked" : undefined } }, { tag: "label", namespace: "html", attributes: { for: "protocol-oai" }, properties: { innerHTML: "OAI-PMH" } } ] },
        { tag: "div", styles: { display: "flex", alignItems: "center", gap: "5px" }, children: [ { tag: "input", namespace: "html", id: "protocol-ixtheo", attributes: { type: "radio", name: "protocol", value: "ixtheo", checked: dialogData.protocol === "ixtheo" ? "checked" : undefined } }, { tag: "label", namespace: "html", attributes: { for: "protocol-ixtheo" }, properties: { innerHTML: "IxTheo" } } ] }
      ]
    })
    .addCell(3, 0, { tag: "label", namespace: "html", properties: { textContent: getString("search-dialog-endpoint") } })
    .addCell(3, 1, { tag: "div", namespace: "html", children: [
        { tag: "select", namespace: "html", id: "endpoint-sru", styles: { width: "100%" }, children: Object.entries(SRU_ENDPOINTS).map(([key, details]) => ({ tag: "option", namespace: "html", properties: { value: key, innerHTML: details.name, selected: dialogData.endpoint === key && dialogData.protocol === 'sru' } })) },
        { tag: "select", namespace: "html", id: "endpoint-oai", styles: { width: "100%" }, children: Object.entries(OAI_ENDPOINTS).map(([key, details]) => ({ tag: "option", namespace: "html", properties: { value: key, innerHTML: details.name, selected: dialogData.endpoint === key && dialogData.protocol === 'oai' } })) },
        { tag: "select", namespace: "html", id: "endpoint-ixtheo", styles: { width: "100%" }, children: Object.entries(IXTHEO_ENDPOINTS).map(([key, details]) => ({ tag: "option", namespace: "html", properties: { value: key, innerHTML: details.name, selected: dialogData.endpoint === key && dialogData.protocol === 'ixtheo' } })) }
      ]
    })
    .addCell(4, 0, { tag: "div", id: "schema-row", styles: { gridColumn: "1 / span 2", marginTop: '10px' }, children: [
             { tag: "div", styles: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [
                 { tag: "label", namespace: "html", properties: { textContent: "Schema:" }, styles: { width: '100px'} },
                 { tag: "div", namespace: "html", styles: { display: "flex", flexWrap: "wrap", gap: "10px", flexGrow: 1 }, children: [
                     { tag: "div", styles: { display: "flex", alignItems: "center", gap: "5px" }, children: [ { tag: "input", namespace: "html", id: "schema-default", attributes: { type: "radio", name: "schema", value: "", checked: "checked" }, listeners: [{ type: "change", listener: (e: Event) => { if ((e.target as HTMLInputElement).checked) dialogData.schema = ""; } }] }, { tag: "label", namespace: "html", attributes: { for: "schema-default" }, properties: { innerHTML: "Default" } } ] },
                     { tag: "div", styles: { display: "flex", alignItems: "center", gap: "5px" }, children: [ { tag: "input", namespace: "html", id: "schema-marcxml", attributes: { type: "radio", name: "schema", value: "marcxml" }, listeners: [{ type: "change", listener: (e: Event) => { if ((e.target as HTMLInputElement).checked) dialogData.schema = "marcxml"; } }] }, { tag: "label", namespace: "html", attributes: { for: "schema-marcxml" }, properties: { innerHTML: "MARCXML" } } ] },
                     { tag: "div", styles: { display: "flex", alignItems: "center", gap: "5px" }, children: [ { tag: "input", namespace: "html", id: "schema-dc", attributes: { type: "radio", name: "schema", value: "dc" }, listeners: [{ type: "change", listener: (e: Event) => { if ((e.target as HTMLInputElement).checked) dialogData.schema = "dc"; } }] }, { tag: "label", namespace: "html", attributes: { for: "schema-dc" }, properties: { innerHTML: "DC" } } ] },
                 ]}
             ]}
        ]
    })
    .addCell(5, 0, { tag: "div", id: "oai-options-container", styles: { gridColumn: "1 / span 2", border: "1px solid var(--ls-border-color, #555)", padding: "10px", marginTop: "10px", borderRadius: "4px", flexDirection: 'column', gap: '10px' }, children: [
            { tag: "h3", properties: { innerHTML: "OAI-PMH Options"}, styles: { marginTop: 0, marginBottom: '5px' } },
            { tag: "div", styles: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [
                { tag: "label", namespace: "html", attributes: { for: "oai-set" }, properties: { innerHTML: getString("search-dialog-oai-set") }, styles: { width: '100px', flexShrink: 0 } },
                { tag: "select", namespace: "html", id: "oai-set", styles: { flexGrow: 1 }, listeners: [{ type: "change", listener: (e: Event) => { dialogData.oaiSet = (e.target as HTMLSelectElement).value; } }], children: [ { tag: "option", namespace: "html", properties: { value: "", innerHTML: "Update to load sets" } } ] },
                { tag: "button", namespace: "html", id: "oai-update-sets-button", properties: { innerHTML: getString("search-dialog-oai-update-sets") }, attributes: { disabled: true } }
            ]},
            { tag: "div", styles: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [
                { tag: "label", namespace: "html", attributes: { for: "oai-prefix" }, properties: { innerHTML: getString("search-dialog-oai-prefix") }, styles: { width: '100px', flexShrink: 0 } },
                { tag: "input", namespace: "html", id: "oai-prefix", attributes: { type: "text", value: dialogData.oaiPrefix }, styles: { flexGrow: 1 }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.oaiPrefix = (e.target as HTMLInputElement).value; } }] }
            ]},
            { tag: "div", styles: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }, children: [
                { tag: "label", namespace: "html", attributes: { for: "oai-from" }, properties: { innerHTML: getString("search-dialog-oai-from") }, styles: { width: '100px', flexShrink: 0 } },
                { tag: "input", namespace: "html", id: "oai-from", attributes: { type: "date", value: dialogData.oaiFrom }, styles: { flexGrow: 1, minWidth: '120px' }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.oaiFrom = (e.target as HTMLInputElement).value; } }] },
                { tag: "label", namespace: "html", attributes: { for: "oai-until" }, properties: { innerHTML: getString("search-dialog-oai-until") }, styles: { marginLeft: '10px', width: 'auto'} },
                { tag: "input", namespace: "html", id: "oai-until", attributes: { type: "date", value: dialogData.oaiUntil }, styles: { flexGrow: 1, minWidth: '120px' }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.oaiUntil = (e.target as HTMLInputElement).value; } }] }
            ]}
        ]
    })
    // Rows 6-11 (Standard Fields + Debug) - Unchanged
    .addCell(6, 0, { tag: "label", namespace: "html", id: "title-label", attributes: { for: "title" }, properties: { innerHTML: getString("search-dialog-title-field") } })
    .addCell(6, 1, { tag: "input", namespace: "html", id: "title", attributes: { type: "text", value: dialogData.title }, styles: { width: "100%" }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.title = (e.target as HTMLInputElement).value; } }] })
    .addCell(7, 0, { tag: "label", namespace: "html", id: "author-label", attributes: { for: "author" }, properties: { innerHTML: getString("search-dialog-author") } })
    .addCell(7, 1, { tag: "input", namespace: "html", id: "author", attributes: { type: "text", value: dialogData.author }, styles: { width: "100%" }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.author = (e.target as HTMLInputElement).value; } }] })
    .addCell(8, 0, { tag: "label", namespace: "html", id: "isbn-label", attributes: { for: "isbn" }, properties: { innerHTML: getString("search-dialog-isbn") } })
    .addCell(8, 1, { tag: "input", namespace: "html", id: "isbn", attributes: { type: "text", value: dialogData.isbn }, styles: { width: "100%" }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.isbn = (e.target as HTMLInputElement).value; } }] })
    .addCell(9, 0, { tag: "label", namespace: "html", id: "max-results-label", attributes: { for: "maxResults" }, properties: { innerHTML: getString("search-dialog-max-results") } })
    .addCell(9, 1, { tag: "input", namespace: "html", id: "maxResults", attributes: { type: "number", min: "1", max: "100", value: dialogData.maxResults.toString() }, styles: { width: "80px" }, listeners: [{ type: "input", listener: (e: Event) => { const input = e.target as HTMLInputElement; const value = parseInt(input.value, 10); if (!isNaN(value) && value > 0) { dialogData.maxResults = value; } } }] })
    .addCell(10, 0, { tag: "label", namespace: "html", id: "all-fields-label", attributes: { for: "all-fields-term" }, properties: { innerHTML: getString("search-dialog-allfields") } })
    .addCell(10, 1, { tag: "input", namespace: "html", id: "all-fields-term", attributes: { type: "text", value: dialogData.allFieldsTerm }, styles: { width: "100%" }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.allFieldsTerm = (e.target as HTMLInputElement).value; } }] })
    .addCell(11, 0, { tag: "label", namespace: "html", attributes: { for: "debug-mode" }, properties: { innerHTML: "Enable debug mode" } })
    .addCell(11, 1, { tag: "input", namespace: "html", id: "debug-mode", attributes: { type: "checkbox", checked: getPref("debugMode") ? "checked" : undefined }, listeners: [{ type: "change", listener: (e: Event) => { setPref("debugMode", (e.target as HTMLInputElement).checked); } }] })
    // Buttons - Unchanged
    .addButton(getString("search-dialog-search-button"), "search", {
      callback: async (e: Event) => {
         // --- Get current values from UI before search ---
         if (dialogHelper.window) {
             const doc = dialogHelper.window.document;
             const selectedProtocolEl = doc.querySelector('input[name="protocol"]:checked') as HTMLInputElement;
             if (selectedProtocolEl) dialogData.protocol = selectedProtocolEl.value;

             const endpointSelectId = `endpoint-${dialogData.protocol}`;
             const endpointSelect = doc.getElementById(endpointSelectId) as HTMLSelectElement | null;
             if (endpointSelect && endpointSelect.options.length > 0 && endpointSelect.selectedIndex >= 0) { dialogData.endpoint = endpointSelect.value; }
             else if (endpointSelect && endpointSelect.options.length > 0) { dialogData.endpoint = (endpointSelect.options[0] as HTMLOptionElement)?.value || ''; }
             else { dialogData.endpoint = ''; }

             const maxResultsInput = doc.getElementById('maxResults') as HTMLInputElement | null;
             let parsedMaxResults = dialogData.maxResults;
             if (maxResultsInput) { const parsed = parseInt(maxResultsInput.value, 10); if (!isNaN(parsed) && parsed > 0) { parsedMaxResults = parsed; } }
             dialogData.maxResults = parsedMaxResults;

             const allFieldsInput = doc.getElementById('all-fields-term') as HTMLInputElement | null;
             dialogData.allFieldsTerm = allFieldsInput ? allFieldsInput.value : "";

             if (dialogData.protocol === 'sru') {
                 const selectedSchemaEl = doc.querySelector('input[name="schema"]:checked') as HTMLInputElement | null; dialogData.schema = selectedSchemaEl ? selectedSchemaEl.value : "";
                 const titleInput = doc.getElementById('title') as HTMLInputElement | null; dialogData.title = titleInput ? titleInput.value : "";
                 const authorInput = doc.getElementById('author') as HTMLInputElement | null; dialogData.author = authorInput ? authorInput.value : "";
                 const isbnInput = doc.getElementById('isbn') as HTMLInputElement | null; dialogData.isbn = isbnInput ? isbnInput.value : "";
                 dialogData.oaiSet = undefined; dialogData.oaiPrefix = undefined; dialogData.oaiFrom = undefined; dialogData.oaiUntil = undefined;
             } else if (dialogData.protocol === 'oai') {
                 const setSelect = doc.getElementById('oai-set') as HTMLSelectElement | null; dialogData.oaiSet = setSelect ? setSelect.value : undefined;
                 const prefixInput = doc.getElementById('oai-prefix') as HTMLInputElement | null; dialogData.oaiPrefix = prefixInput ? prefixInput.value : undefined;
                 const fromInput = doc.getElementById('oai-from') as HTMLInputElement | null; dialogData.oaiFrom = fromInput ? fromInput.value : undefined;
                 const untilInput = doc.getElementById('oai-until') as HTMLInputElement | null; dialogData.oaiUntil = untilInput ? untilInput.value : undefined;
                 dialogData.title = ""; dialogData.author = ""; dialogData.isbn = ""; dialogData.allFieldsTerm = ""; dialogData.schema = "";
             } else if (dialogData.protocol === 'ixtheo') {
                 dialogData.title = ""; dialogData.author = ""; dialogData.isbn = ""; dialogData.schema = "";
                 dialogData.oaiSet = undefined; dialogData.oaiPrefix = undefined; dialogData.oaiFrom = undefined; dialogData.oaiUntil = undefined;
             }
         }
         // --- End Get current values ---

         // --- Validation (remains the same) ---
         if (dialogData.searching) return;
         if (!dialogData.endpoint) { dialogHelper.window?.alert(getString("search-error-missing-endpoint")); return; }
         if (dialogData.protocol === 'sru' && !dialogData.title && !dialogData.author && !dialogData.isbn && !dialogData.allFieldsTerm) { dialogHelper.window?.alert(getString("search-error-missing-search-terms")); return; }
         if (dialogData.protocol === 'oai' && !dialogData.oaiPrefix) { dialogHelper.window?.alert("Metadata Prefix is required for OAI-PMH search."); return; }
         if (dialogData.protocol === 'ixtheo' && !dialogData.allFieldsTerm) { dialogHelper.window?.alert("Search term is required for IxTheo search."); return; }

          // --- Search Execution (remains the same) ---
          dialogData.searching = true; dialogData.searchComplete = false; dialogData.errorMessage = "";
          const searchButton = dialogHelper.window?.document?.getElementById("search") as HTMLButtonElement | null; if (searchButton) { searchButton.disabled = true; searchButton.textContent = getString("search-dialog-searching"); }
          try {
            const searchParams: SearchParams = {
              protocol: dialogData.protocol, endpoint: dialogData.endpoint, schema: dialogData.schema,
              set: dialogData.oaiSet, metadataPrefix: dialogData.oaiPrefix, from: dialogData.oaiFrom, until: dialogData.oaiUntil,
              title: dialogData.title, author: dialogData.author, isbn: dialogData.isbn, allFieldsTerm: dialogData.allFieldsTerm,
              maxRecords: dialogData.maxResults,
            };
            ztoolkit.log("Executing search with params:", searchParams);
            const [success, results, totalRecords] = await LibrarySearchIntegration.executeSearch(searchParams);
            if (success && results && results.length > 0) {
              addon.data.lastSearchResults = results; const searchDialogRef = addon.data.dialog; addon.data.dialog = undefined;
              if (searchDialogRef?.window && !searchDialogRef.window.closed) { searchDialogRef.window.close(); }
              await LibrarySearchIntegration.openResultsDialog(results, totalRecords, searchParams);
            } else { dialogData.errorMessage = getString("search-dialog-no-results"); dialogHelper.window?.alert(getString("search-dialog-no-results")); }
          } catch (error: any) {
            ztoolkit.log("Search error:", error); dialogData.errorMessage = error?.message || getString("search-dialog-error");
            dialogHelper.window?.alert(`Search Error: ${dialogData.errorMessage}`);
          } finally { dialogData.searching = false; if (searchButton) { searchButton.disabled = false; searchButton.textContent = getString("search-dialog-search-button"); } }
      },
      noClose: true
    })
    .addButton(getString("search-dialog-cancel-button"), "cancel");

  // Set dialog data
  dialogHelper.setDialogData(dialogData);

  // Open the dialog and store reference
  dialogHelper.open(getString("search-dialog-title"), { width: 650, height: 650 });
  addon.data.dialog = dialogHelper;

  // Initialize AFTER open() using DOMContentLoaded
  if (dialogHelper.window) {
      const win = dialogHelper.window as Window;
      ztoolkit.log("Initialization: Window object found after open(), attaching DOMContentLoaded listener...");

      win.addEventListener('DOMContentLoaded', () => {
          ztoolkit.log("Initialization: DOMContentLoaded event fired.");
          const doc = win.document;

          // --- Get references to ALL standard field rows/labels/inputs ---
          const titleLabel = doc.getElementById("title-label") as HTMLElement | null;
          const titleInput = doc.getElementById("title") as HTMLElement | null;
          const authorLabel = doc.getElementById("author-label") as HTMLElement | null;
          const authorInput = doc.getElementById("author") as HTMLElement | null;
          const isbnLabel = doc.getElementById("isbn-label") as HTMLElement | null;
          const isbnInput = doc.getElementById("isbn") as HTMLElement | null;
          const allFieldsLabel = doc.getElementById("all-fields-label") as HTMLElement | null;
          const allFieldsInput = doc.getElementById("all-fields-term") as HTMLElement | null;
          const maxResultsLabel = doc.getElementById("max-results-label") as HTMLElement | null;
          const maxResultsInput = doc.getElementById("maxResults") as HTMLElement | null;
          const debugLabel = doc.querySelector('label[for="debug-mode"]') as HTMLElement | null;
          const debugInput = doc.getElementById("debug-mode") as HTMLElement | null;

          // --- Helper Function for Visibility (Complete) ---
          const updateVisibility = (protocol: string) => {
            ztoolkit.log(`Initialization: Updating visibility for protocol: ${protocol}`);
            const doc = win.document; // Ensure doc is accessible

            // --- Get references to ALL relevant elements ---
            // Endpoint Selects
            const sruSelect = doc.getElementById("endpoint-sru") as HTMLElement | null;
            const oaiSelect = doc.getElementById("endpoint-oai") as HTMLElement | null;
            const ixtheoSelect = doc.getElementById("endpoint-ixtheo") as HTMLElement | null;
            // SRU Specific Inputs/Rows
            const schemaRow = doc.getElementById("schema-row") as HTMLElement | null;
            const titleLabel = doc.getElementById("title-label") as HTMLElement | null;
            const titleInput = doc.getElementById("title") as HTMLElement | null;
            const authorLabel = doc.getElementById("author-label") as HTMLElement | null;
            const authorInput = doc.getElementById("author") as HTMLElement | null;
            const isbnLabel = doc.getElementById("isbn-label") as HTMLElement | null;
            const isbnInput = doc.getElementById("isbn") as HTMLElement | null;
            // OAI Specific Inputs/Rows
            const oaiOptionsContainer = doc.getElementById("oai-options-container") as HTMLElement | null;
            // IxTheo Specific Inputs/Rows
            const allFieldsLabel = doc.getElementById("all-fields-label") as HTMLElement | null;
            const allFieldsInput = doc.getElementById("all-fields-term") as HTMLElement | null;
            // Common Inputs/Rows (Always visible)
            const maxResultsLabel = doc.getElementById("max-results-label") as HTMLElement | null;
            const maxResultsInput = doc.getElementById("maxResults") as HTMLElement | null;
            const debugLabel = doc.querySelector('label[for="debug-mode"]') as HTMLElement | null;
            const debugInput = doc.getElementById("debug-mode") as HTMLElement | null;

            // Group elements for easier management
            const sruFields = [titleLabel, titleInput, authorLabel, authorInput, isbnLabel, isbnInput];
            const oaiFields = [oaiOptionsContainer];
            const ixtheoFields = [allFieldsLabel, allFieldsInput];
            const commonFields = [maxResultsLabel, maxResultsInput, debugLabel, debugInput];

            // 1. Hide ALL protocol-specific endpoint selects first
            if (sruSelect) sruSelect.style.display = "none";
            if (oaiSelect) oaiSelect.style.display = "none";
            if (ixtheoSelect) ixtheoSelect.style.display = "none";

            // 2. Hide ALL potentially protocol-specific input fields/rows
            if (schemaRow) schemaRow.style.display = "none"; // SRU specific schema row
            [...sruFields, ...oaiFields, ...ixtheoFields].forEach(el => {
                if (el) el.style.display = 'none';
            });
            // Also hide the 'All Fields' input initially, it will be shown explicitly for SRU/IxTheo
            if (allFieldsLabel) allFieldsLabel.style.display = 'none';
            if (allFieldsInput) allFieldsInput.style.display = 'none';


            // 3. Show elements for the SELECTED protocol
            let currentEndpointSelect: HTMLSelectElement | null = null;
            if (protocol === "sru") {
                if (sruSelect) { sruSelect.style.display = ""; currentEndpointSelect = sruSelect as HTMLSelectElement; }
                if (schemaRow) schemaRow.style.display = ""; // Show schema row
                // Show SRU input fields (Title, Author, ISBN, All Fields)
                [...sruFields, allFieldsLabel, allFieldsInput].forEach(el => {
                     if (el) el.style.display = '';
                });
            } else if (protocol === "oai") {
                if (oaiSelect) { oaiSelect.style.display = ""; currentEndpointSelect = oaiSelect as HTMLSelectElement; }
                // Show OAI input fields (Set, Prefix, Dates container)
                oaiFields.forEach(el => { if (el) el.style.display = ''; });
                const updateButton = doc.getElementById('oai-update-sets-button') as HTMLButtonElement | null;
                if (updateButton) updateButton.disabled = false; // Enable OAI button
            } else if (protocol === "ixtheo") {
                if (ixtheoSelect) { ixtheoSelect.style.display = ""; currentEndpointSelect = ixtheoSelect as HTMLSelectElement; }
                // Show ONLY All Fields for IxTheo inputs
                ixtheoFields.forEach(el => { if (el) el.style.display = ''; });
            }

            // 4. *** ALWAYS ensure common fields are visible ***
            commonFields.forEach(el => {
                if (el) el.style.display = ''; // Use default display (e.g., block, inline-block)
            });

            // 5. Update endpoint data based on the now-visible select
            if (currentEndpointSelect && currentEndpointSelect.options.length > 0) {
                // If an option is selected, use its value
                if (currentEndpointSelect.selectedIndex >= 0) {
                    dialogData.endpoint = currentEndpointSelect.value;
                } else {
                    // Otherwise, default to the first option's value
                    dialogData.endpoint = (currentEndpointSelect.options[0] as HTMLOptionElement)?.value || '';
                    currentEndpointSelect.selectedIndex = 0; // Select the first option visually
                }
                ztoolkit.log(`Initialization: Updated endpoint data to: ${dialogData.endpoint}`);
            } else {
                // If no select or no options, clear the endpoint
                dialogData.endpoint = '';
                ztoolkit.log(`Initialization: Cleared endpoint data as no select/options found for protocol ${protocol}.`);
            }

            // 6. Clear schema if the protocol is not SRU
            if (protocol !== "sru") {
                dialogData.schema = ""; // Reset schema data
                // Optionally, uncheck schema radio buttons if they exist
                const schemaRadios = doc.querySelectorAll('input[name="schema"]') as NodeListOf<HTMLInputElement>;
                schemaRadios.forEach((radio: HTMLInputElement) => radio.checked = false);
                ztoolkit.log(`Initialization: Cleared schema as protocol is not SRU.`);
            }

            ztoolkit.log("Initialization: Visibility update complete.");
        }; // End of updateVisibility function

          // --- Attach Listeners (Unchanged) ---
          const protocolRadios = doc.querySelectorAll('input[name="protocol"]') as NodeListOf<HTMLInputElement>;
          ztoolkit.log(`Initialization: Found ${protocolRadios.length} protocol radios.`);
          protocolRadios.forEach((radio: HTMLInputElement) => {
              radio.addEventListener('change', function(e: Event) {
                  ztoolkit.log("Initialization: Protocol radio changed.");
                  const target = e.target as HTMLInputElement;
                  if (target.checked) { dialogData.protocol = target.value; ztoolkit.log(`Initialization: New protocol selected: ${dialogData.protocol}`); updateVisibility(dialogData.protocol); }
              });
          });
          const sruEndpointSelect = doc.getElementById('endpoint-sru') as HTMLSelectElement | null;
          const oaiEndpointSelect = doc.getElementById('endpoint-oai') as HTMLSelectElement | null;
          const ixtheoEndpointSelect = doc.getElementById('endpoint-ixtheo') as HTMLSelectElement | null;
          const setSelect = doc.getElementById('oai-set') as HTMLSelectElement | null;
          const updateSetsButton = doc.getElementById('oai-update-sets-button') as HTMLButtonElement | null;
          if (sruEndpointSelect) sruEndpointSelect.addEventListener('change', (e) => { if (dialogData.protocol === 'sru') { dialogData.endpoint = (e.target as HTMLSelectElement).value; ztoolkit.log(`Initialization: SRU endpoint changed to: ${dialogData.endpoint}`); } });
          if (ixtheoEndpointSelect) ixtheoEndpointSelect.addEventListener('change', (e) => { if (dialogData.protocol === 'ixtheo') { dialogData.endpoint = (e.target as HTMLSelectElement).value; ztoolkit.log(`Initialization: IxTheo endpoint changed to: ${dialogData.endpoint}`); } });
          if (oaiEndpointSelect) {
              oaiEndpointSelect.addEventListener('change', (e) => {
                   if (dialogData.protocol === 'oai') {
                       dialogData.endpoint = (e.target as HTMLSelectElement).value; ztoolkit.log(`Initialization: OAI endpoint changed to: ${dialogData.endpoint}`);
                       const endpointDetails = OAI_ENDPOINTS[dialogData.endpoint]; dialogData.oaiPrefix = endpointDetails?.defaultMetadataPrefix || 'oai_dc';
                       const prefixInput = doc.getElementById('oai-prefix') as HTMLInputElement | null; if (prefixInput) prefixInput.value = dialogData.oaiPrefix;
                       if (setSelect) { while (setSelect.firstChild) { setSelect.removeChild(setSelect.firstChild); } const placeholderOption = doc.createElement('option'); placeholderOption.value = ''; placeholderOption.textContent = 'Update to load sets'; setSelect.appendChild(placeholderOption); dialogData.oaiSet = ''; }
                       if (updateSetsButton) updateSetsButton.disabled = false;
                   }
               });
          } else { ztoolkit.log("Initialization: OAI Endpoint Select not found for listener attachment.", "warn"); }
          if (updateSetsButton && setSelect && oaiEndpointSelect) {
              ztoolkit.log("Initialization: Attaching OAI Update Sets button listener.");
              updateSetsButton.addEventListener('click', async () => {
                  ztoolkit.log("Initialization: OAI Update Sets button clicked.");
                  if (dialogData.protocol !== 'oai') { ztoolkit.log("Update Sets clicked, but OAI protocol not active. Ignoring.", "warn"); return; }
                  const endpointKey = oaiEndpointSelect.value; if (!endpointKey) { win.alert('Please select an OAI endpoint first.'); return; }
                  const endpointDetails = OAI_ENDPOINTS[endpointKey]; if (!endpointDetails || !endpointDetails.url) { win.alert(`Endpoint URL not found for key: ${endpointKey}`); return; }
                  const baseUrl = endpointDetails.url;
                  updateSetsButton.textContent = 'Loading...'; updateSetsButton.disabled = true; setSelect.disabled = true;
                  try {
                      const client = new OAIClient(baseUrl); const sets = await client.listSets();
                      while (setSelect.firstChild) { setSelect.removeChild(setSelect.firstChild); } const allSetsOption = doc.createElement('option'); allSetsOption.value = ''; allSetsOption.textContent = 'All Sets'; setSelect.appendChild(allSetsOption);
                      for (const [spec, name] of Object.entries(sets)) { const option = doc.createElement('option'); option.value = spec; option.textContent = `${name} (${spec})`; setSelect.appendChild(option); }
                      dialogData.oaiSet = setSelect.value; ztoolkit.log("Initialization: OAI Sets loaded successfully.");
                  } catch (error: any) {
                      console.error("Error fetching OAI sets:", error); win.alert(`Failed to fetch OAI sets: ${error.message || error}. See console for details.`);
                      while (setSelect.firstChild) { setSelect.removeChild(setSelect.firstChild); } const errorOption = doc.createElement('option'); errorOption.value = ''; errorOption.textContent = 'Error loading sets'; setSelect.appendChild(errorOption);
                  } finally { updateSetsButton.textContent = getString('search-dialog-oai-update-sets'); setSelect.disabled = false; updateSetsButton.disabled = false; }
              });
          } else { ztoolkit.log("Initialization: Could not find all elements for OAI Update Sets listener.", "warn"); }

          // --- Set Initial Visibility ---
          ztoolkit.log(`Initialization: Setting initial visibility for protocol: ${dialogData.protocol}`);
          updateVisibility(dialogData.protocol);
          ztoolkit.log("Initialization: Initial setup complete.");

      }); // End of DOMContentLoaded listener

  } else {
      ztoolkit.log("Initialization Error: dialogHelper.window is not available immediately after open().", "error");
  }

} // End of openSearchDialog