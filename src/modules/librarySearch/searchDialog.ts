// src/modules/librarySearch/searchDialog.ts

// Imports
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import { ThemeUtils } from "../themeUtils";
import { OAIClient } from "./oaiClient";
import { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS } from "./endpoints";
import { SRUEndpoint, OAIEndpoint, IxTheoEndpoint  } from "./models";
import { LibrarySearchIntegration, SearchParams } from "./integration";
import { SearchService } from "./searchService"; 


/**
 * Enhanced dialog creation with proper styling
 * NOTE: We keep this function as is for styling consistency.
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
    // Rows 0-5 (Protocol, Endpoint, Schema, OAI Options) 
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
              // only a text field for the sets
              { tag: "input", namespace: "html", id: "oai-set", attributes: { type: "text" }, styles: { flexGrow: 1 }, listeners: [{ type: "input", listener: (e: Event) => { dialogData.oaiSet = (e.target as HTMLInputElement).value; } }] },
              // a button text for "List Sets"
              { tag: "button", namespace: "html", id: "oai-list-sets-button", properties: { innerHTML: "List Sets" } }
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
    // Rows 6-11 (Standard Fields + Debug) 
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
    // Buttons 
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

         // --- Validation ---
         if (dialogData.searching) return;
         if (!dialogData.endpoint) { dialogHelper.window?.alert(getString("search-error-missing-endpoint")); return; }
         if (dialogData.protocol === 'sru' && !dialogData.title && !dialogData.author && !dialogData.isbn && !dialogData.allFieldsTerm) { dialogHelper.window?.alert(getString("search-error-missing-search-terms")); return; }
         if (dialogData.protocol === 'oai' && !dialogData.oaiPrefix) { dialogHelper.window?.alert("Metadata Prefix is required for OAI-PMH search."); return; }
         if (dialogData.protocol === 'ixtheo') {
              // Retrieve the UI values directly to ensure we have the most current data
              if (dialogHelper.window) {
                  const doc = dialogHelper.window.document;
                  const titleInput = doc.getElementById('title') as HTMLInputElement | null;
                  const authorInput = doc.getElementById('author') as HTMLInputElement | null;
                  const isbnInput = doc.getElementById('isbn') as HTMLInputElement | null;
                  const allFieldsInput = doc.getElementById('all-fields-term') as HTMLInputElement | null;
                  
                  // Update dialog data with current UI values
                  dialogData.title = titleInput?.value || "";
                  dialogData.author = authorInput?.value || "";
                  dialogData.isbn = isbnInput?.value || "";
                  dialogData.allFieldsTerm = allFieldsInput?.value || "";
              }
              
              // Now check if we have at least one non-empty search term
              if (!dialogData.title?.trim() && !dialogData.author?.trim() && 
                  !dialogData.isbn?.trim() && !dialogData.allFieldsTerm?.trim()) {
                  dialogHelper.window?.alert(getString("search-error-missing-search-terms"));
                  return;
              }
          }

          // --- Search Execution ---
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
            const [success, results, totalRecords, initialOaiToken] = await LibrarySearchIntegration.executeSearch(searchParams);
            if (success && results && results.length > 0) {
              addon.data.lastSearchResults = results; const searchDialogRef = addon.data.dialog; addon.data.dialog = undefined;
              if (searchDialogRef?.window && !searchDialogRef.window.closed) { searchDialogRef.window.close(); }
              await LibrarySearchIntegration.openResultsDialog(results, totalRecords, searchParams, initialOaiToken);
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
      // After if (dialogHelper.window) {
const win = dialogHelper.window as Window;
ztoolkit.log("Initialization: Window object found after open(), attaching DOMContentLoaded listener...");

win.addEventListener('DOMContentLoaded', () => {
  const logPrefix = "[SearchDialog DOMInit]"; // Prefix for logs from this scope
  ztoolkit.log(`${logPrefix} DOMContentLoaded event fired.`);
  const doc = win.document;

  // --- Get references to common / shared elements ---
  const sruEndpointSelect = doc.getElementById('endpoint-sru') as HTMLSelectElement | null;
  const oaiEndpointSelect = doc.getElementById('endpoint-oai') as HTMLSelectElement | null;
  const ixtheoEndpointSelect = doc.getElementById('endpoint-ixtheo') as HTMLSelectElement | null;
  const protocolRadios = doc.querySelectorAll('input[name="protocol"]') as NodeListOf<HTMLInputElement>;

  // OAI Specific elements needed for the new approach
  const setInput = doc.getElementById('oai-set') as HTMLInputElement | null;
  const listSetsButton = doc.getElementById('oai-list-sets-button') as HTMLButtonElement | null;
  const oaiPrefixInput = doc.getElementById('oai-prefix') as HTMLInputElement | null;

  // --- Helper Function for Visibility (Includes IxTheo Fix) ---
  const updateVisibility = (protocol: string) => {
      ztoolkit.log(`${logPrefix} Updating visibility for protocol: ${protocol}`);
      // Get references *inside* function to ensure they are fresh if DOM changes (though unlikely here)
      const sruSelect = doc.getElementById("endpoint-sru") as HTMLElement | null;
      const oaiSelect = doc.getElementById("endpoint-oai") as HTMLElement | null;
      const ixtheoSelect = doc.getElementById("endpoint-ixtheo") as HTMLElement | null;
      const schemaRow = doc.getElementById("schema-row") as HTMLElement | null;
      const titleLabel = doc.getElementById("title-label") as HTMLElement | null;
      const titleInput = doc.getElementById("title") as HTMLElement | null;
      const authorLabel = doc.getElementById("author-label") as HTMLElement | null;
      const authorInput = doc.getElementById("author") as HTMLElement | null;
      const isbnLabel = doc.getElementById("isbn-label") as HTMLElement | null;
      const isbnInput = doc.getElementById("isbn") as HTMLElement | null;
      const oaiOptionsContainer = doc.getElementById("oai-options-container") as HTMLElement | null;
      const allFieldsLabel = doc.getElementById("all-fields-label") as HTMLElement | null;
      const allFieldsInput = doc.getElementById("all-fields-term") as HTMLElement | null;
      const maxResultsLabel = doc.getElementById("max-results-label") as HTMLElement | null;
      const maxResultsInput = doc.getElementById("maxResults") as HTMLElement | null;
      const debugLabel = doc.querySelector('label[for="debug-mode"]') as HTMLElement | null;
      const debugInput = doc.getElementById("debug-mode") as HTMLElement | null;

      const specificFields = [titleLabel, titleInput, authorLabel, authorInput, isbnLabel, isbnInput];
      const oaiFields = [oaiOptionsContainer];
      const allFieldsGroup = [allFieldsLabel, allFieldsInput];
      const commonFields = [maxResultsLabel, maxResultsInput, debugLabel, debugInput];

      // 1. Hide endpoint selects
      if (sruSelect) sruSelect.style.display = "none";
      if (oaiSelect) oaiSelect.style.display = "none";
      if (ixtheoSelect) ixtheoSelect.style.display = "none";

      // 2. Hide specific input groups/rows
      if (schemaRow) schemaRow.style.display = "none";
      [...specificFields, ...oaiFields, ...allFieldsGroup].forEach(el => {
          if (el) el.style.display = 'none';
      });

      // 3. Show elements for the selected protocol
      let currentEndpointSelect: HTMLSelectElement | null = null;
      if (protocol === "sru") {
          if (sruSelect) { sruSelect.style.display = ""; currentEndpointSelect = sruSelect as HTMLSelectElement; }
          if (schemaRow) schemaRow.style.display = "";
          [...specificFields, ...allFieldsGroup].forEach(el => { if (el) el.style.display = ''; });
      } else if (protocol === "oai") {
          if (oaiSelect) { oaiSelect.style.display = ""; currentEndpointSelect = oaiSelect as HTMLSelectElement; }
          oaiFields.forEach(el => { if (el) el.style.display = ''; });
          if (listSetsButton) listSetsButton.disabled = !currentEndpointSelect?.value; // Disable if no endpoint selected
      } else if (protocol === "ixtheo") {
          if (ixtheoSelect) { ixtheoSelect.style.display = ""; currentEndpointSelect = ixtheoSelect as HTMLSelectElement; }
          [...specificFields, ...allFieldsGroup].forEach(el => { if (el) el.style.display = ''; });
      }

      // 4. Ensure common fields are visible
      commonFields.forEach(el => { if (el) el.style.display = ''; });

      // 5. Update endpoint data
      if (currentEndpointSelect?.value) {
          dialogData.endpoint = currentEndpointSelect.value;
          ztoolkit.log(`${logPrefix} Updated endpoint data to: ${dialogData.endpoint}`);
      } else if (currentEndpointSelect && currentEndpointSelect.options.length > 0) {
          // Fallback if no value but options exist (select first)
          dialogData.endpoint = (currentEndpointSelect.options[0] as HTMLOptionElement)?.value || '';
          currentEndpointSelect.selectedIndex = 0;
          ztoolkit.log(`${logPrefix} No endpoint selected, defaulting to first: ${dialogData.endpoint}`);
      } else {
          dialogData.endpoint = '';
          ztoolkit.log(`${logPrefix} Cleared endpoint data (no select/options for protocol ${protocol}).`);
      }

      // 6. Clear schema if not SRU
      if (protocol !== "sru") {
          if (dialogData.schema) { // Only log if it was actually cleared
             ztoolkit.log(`${logPrefix} Clearing schema as protocol is not SRU.`);
             dialogData.schema = "";
             const schemaRadios = doc.querySelectorAll('input[name="schema"]') as NodeListOf<HTMLInputElement>;
             schemaRadios.forEach((radio: HTMLInputElement) => radio.checked = false);
          }
      }

      // 7. Update OAI prefix if protocol is OAI
      if (protocol === 'oai') {
         const endpointDetails = OAI_ENDPOINTS[dialogData.endpoint];
         dialogData.oaiPrefix = endpointDetails?.defaultMetadataPrefix || 'oai_dc';
         if (oaiPrefixInput) oaiPrefixInput.value = dialogData.oaiPrefix;
         ztoolkit.log(`${logPrefix} Updated OAI prefix based on endpoint: ${dialogData.oaiPrefix}`);
      }

      ztoolkit.log(`${logPrefix} Visibility update complete.`);
  }; // End of updateVisibility

  // --- Attach Protocol Radio Listeners ---
  ztoolkit.log(`${logPrefix} Found ${protocolRadios.length} protocol radios.`);
  protocolRadios.forEach((radio: HTMLInputElement) => {
      // Set initial checked state based on dialogData
      if (radio.value === dialogData.protocol) {
         radio.checked = true;
      }
      // Add listener
      radio.addEventListener('change', (e: Event) => {
          ztoolkit.log(`${logPrefix} Protocol radio changed.`);
          const target = e.target as HTMLInputElement;
          if (target.checked) {
              dialogData.protocol = target.value;
              ztoolkit.log(`${logPrefix} New protocol selected: ${dialogData.protocol}`);
              // Update visibility which also handles endpoint selection and OAI prefix
              updateVisibility(dialogData.protocol);
              // Reset OAI set field when protocol changes to OAI
              if (dialogData.protocol === 'oai' && setInput) {
                  ztoolkit.log(`${logPrefix} Resetting OAI set field due to protocol change.`);
                  setInput.value = '';
                  dialogData.oaiSet = ''; // Clear data model value
              }
          }
      });
  });

  // --- Attach Endpoint Select Listeners ---
  const handleEndpointChange = (e: Event, protocol: 'sru' | 'oai' | 'ixtheo') => {
      if (dialogData.protocol === protocol) {
          dialogData.endpoint = (e.target as HTMLSelectElement).value;
          ztoolkit.log(`${logPrefix} ${protocol.toUpperCase()} endpoint changed to: ${dialogData.endpoint}`);
          // Special handling for OAI endpoint change
          if (protocol === 'oai') {
              const endpointDetails = OAI_ENDPOINTS[dialogData.endpoint];
              dialogData.oaiPrefix = endpointDetails?.defaultMetadataPrefix || 'oai_dc';
              if (oaiPrefixInput) oaiPrefixInput.value = dialogData.oaiPrefix;
              ztoolkit.log(`${logPrefix} Updated OAI prefix for new endpoint: ${dialogData.oaiPrefix}`);
              // Reset the set input as the sets are specific to the endpoint
              if (setInput) {
                  ztoolkit.log(`${logPrefix} Resetting OAI set field due to endpoint change.`);
                  setInput.value = '';
                  dialogData.oaiSet = ''; // Clear data model value
              }
              if (listSetsButton) listSetsButton.disabled = false; // Enable button for new endpoint
          }
      }
  };

  if (sruEndpointSelect) sruEndpointSelect.addEventListener('change', (e) => handleEndpointChange(e, 'sru'));
  if (oaiEndpointSelect) oaiEndpointSelect.addEventListener('change', (e) => handleEndpointChange(e, 'oai'));
  if (ixtheoEndpointSelect) ixtheoEndpointSelect.addEventListener('change', (e) => handleEndpointChange(e, 'ixtheo'));

  // --- Attach OAI List Sets Button Listener ---
  if (listSetsButton && setInput && oaiEndpointSelect) {
      ztoolkit.log(`${logPrefix} Attaching OAI List Sets button listener.`);
      
      listSetsButton.addEventListener('click', async () => {
          ztoolkit.log(`${logPrefix} OAI List Sets button clicked.`);
          
          // Ensure OAI protocol is active
          if (dialogData.protocol !== 'oai') {
              ztoolkit.log(`${logPrefix} List Sets clicked, but OAI protocol not active. Ignoring.`, "warn");
              return;
          }
          
          // Get current OAI endpoint key and details
          const endpointKey = oaiEndpointSelect.value;
          if (!endpointKey) {
              ztoolkit.log(`${logPrefix} No OAI endpoint selected.`, "warn");
              win.alert(typeof getString === 'function' ? getString('search-dialog-oai-error-no-endpoint') : 'Please select an OAI endpoint first.');
              return;
          }
          
          const endpointDetails = OAI_ENDPOINTS[endpointKey];
          if (!endpointDetails?.url) {
              ztoolkit.log(`${logPrefix} Endpoint URL not found for key: ${endpointKey}`, "error");
              win.alert(`Configuration error: Endpoint URL not found for key: ${endpointKey}`);
              return;
          }
          
          // --- UI Feedback: Start Loading ---
          const originalButtonText = listSetsButton.textContent;
          listSetsButton.textContent = typeof getString === 'function' ? getString('search-dialog-oai-loading-sets') : 'Loading...';
          listSetsButton.disabled = true;
          
          try {
              // Get or create OAI client
              let client = (SearchService as any)['oaiClients']?.[endpointKey];
              if (!client) {
                  ztoolkit.log(`${logPrefix} Creating new OAIClient for ${endpointKey}`);
                  client = new OAIClient(endpointDetails.url, endpointDetails.defaultMetadataPrefix);
              }
              
              // Fetch sets
              const sets: Record<string, string> = await client.listSets();
              const setCount = Object.keys(sets).length;
              ztoolkit.log(`${logPrefix} OAI listSets returned ${setCount} sets.`);
              
              if (setCount === 0) {
                  win.alert(`No sets found for endpoint ${endpointDetails.name}.`);
              } else {
                  // Open a dialog to display sets
                  openSetsSelectionDialog(sets, endpointDetails.name, (selectedSet) => {
                      if (selectedSet) {
                          setInput.value = selectedSet;
                          dialogData.oaiSet = selectedSet;
                          ztoolkit.log(`${logPrefix} Selected set: ${selectedSet}`);
                      }
                  });
              }
              
          } catch (error: any) {
              ztoolkit.log(`${logPrefix} Error fetching or parsing OAI sets: ${error.message}`, "error");
              
              // Show alert with error message
              win.alert(`Failed to fetch OAI sets for ${endpointDetails.name}: ${error.message || 'Unknown error'}`);
              
          } finally {
              // Reset button state
              listSetsButton.textContent = originalButtonText || "List Sets";
              listSetsButton.disabled = false;
          }
      });
  }

  // --- Attach other listeners (e.g., for OAI prefix changes) ---
  if (setInput) {
     setInput.addEventListener('input', (e) => {
         dialogData.oaiSet = (e.target as HTMLInputElement).value;
         ztoolkit.log(`${logPrefix} OAI Set manually changed to: ${dialogData.oaiSet}`);
     });
  }
  if (oaiPrefixInput) {
     oaiPrefixInput.addEventListener('change', (e) => {
         dialogData.oaiPrefix = (e.target as HTMLInputElement).value;
         ztoolkit.log(`${logPrefix} OAI Prefix manually changed to: ${dialogData.oaiPrefix}`);
     });
  }

  /**
 * Creates and opens a dialog to display and select OAI sets
 */
/**
 * Creates and opens a dialog to display and select OAI sets
 */
function openSetsSelectionDialog(
  sets: Record<string, string>,
  endpointName: string,
  callback: (selectedSet: string | null) => void
): void {
  const dialogHelper = createStyledDialog(5, 1); // Increased rows for info area

  let selectedSetSpec: string | null = null;

  // --- Define updateSetsList function *before* it's used ---
  const updateSetsList = (
      doc: Document,
      selectButton: HTMLButtonElement | null,
      filterValue: string = ""
  ): void => {
      try {
          // Fix 1: Assert getElementById returns HTMLElement or null
          const container = doc.getElementById("sets-container") as HTMLElement | null;
          if (!container) {
              console.error("Sets container not found!");
              ztoolkit.log("Error: Sets container not found in OAI sets dialog.", "error");
              return;
          }

          container.innerHTML = ''; // Clear previous content

          const lowerFilter = filterValue.toLowerCase(); // Lowercase filter once
          const setEntries = Object.entries(sets)
              .filter(([spec, name]) => {
                  if (!filterValue) return true;
                  return spec.toLowerCase().includes(lowerFilter) ||
                         name.toLowerCase().includes(lowerFilter);
              });

          // Fix 2: Assert getElementById returns HTMLElement or null for info area
          const infoArea = doc.getElementById("selection-info") as HTMLElement | null;

          if (setEntries.length === 0) {
              const noResults = doc.createElement('div'); // Returns HTMLDivElement
              noResults.textContent = filterValue ?
                  `No sets matching "${filterValue}"` :
                  "No sets available for this endpoint";
              noResults.style.padding = "10px"; // OK: noResults is HTMLDivElement
              noResults.style.fontStyle = "italic"; // OK
              container.appendChild(noResults);

              if (selectButton) selectButton.disabled = true;
              if (infoArea) { // OK: infoArea is HTMLElement | null
                  infoArea.textContent = filterValue ? "No matching sets found" : "No sets available";
                  infoArea.style.fontStyle = 'italic'; // OK
              }
              selectedSetSpec = null;
              return;
          }

          const list = doc.createElement('div'); // Returns HTMLDivElement
          list.style.display = 'flex'; // OK
          list.style.flexDirection = 'column'; // OK
          list.style.gap = '8px'; // OK
          list.setAttribute('role', 'listbox');
          list.setAttribute('aria-label', `Available sets for ${endpointName}`); // Better accessibility

          setEntries.forEach(([spec, name]) => {
              const item = doc.createElement('div'); // Returns HTMLDivElement
              item.setAttribute('data-spec', spec);
              item.style.padding = '8px'; // OK
              item.style.backgroundColor = 'var(--ls-secondary-background-color, var(--zotero-background-secondary, #f7f7f7))'; // OK
              item.style.borderRadius = '4px'; // OK
              item.style.cursor = 'pointer'; // OK
              item.style.borderLeft = '3px solid transparent'; // OK

              item.tabIndex = 0; // OK: tabIndex is on HTMLElement
              item.setAttribute('role', 'option');
              item.setAttribute('aria-selected', 'false');

              const nameDisplay = doc.createElement('strong'); // Returns HTMLElement
              nameDisplay.textContent = name || spec;
              item.appendChild(nameDisplay);

              if (name) {
                  item.appendChild(doc.createElement('br'));
                  const specSpan = doc.createElement('span'); // Returns HTMLSpanElement
                  specSpan.style.fontSize = '0.9em'; // OK
                  specSpan.style.color = 'var(--ls-text-secondary-color, var(--zotero-text-secondary, #555))'; // OK
                  specSpan.textContent = spec;
                  item.appendChild(specSpan);
              }

              item.addEventListener('click', () => {
                  // Assert elements in querySelectorAll are HTMLElements
                  container.querySelectorAll<HTMLDivElement>('div[data-spec]').forEach((el: HTMLDivElement) => {
                      // Now 'el' is correctly typed as HTMLDivElement (subtype of HTMLElement)
                      el.style.borderLeftColor = 'transparent'; // OK
                      el.style.backgroundColor = 'var(--ls-secondary-background-color, var(--zotero-background-secondary, #f7f7f7))'; // OK
                      el.setAttribute('aria-selected', 'false');
                  });

                  item.style.borderLeftColor = 'var(--ls-accent-color, var(--zotero-link-color, #0366d6))'; // OK
                  item.style.backgroundColor = 'var(--ls-highlight-color, var(--zotero-background-selected, #e8f1fa))'; // OK
                  item.setAttribute('aria-selected', 'true');
                  selectedSetSpec = spec;

                  if (selectButton) {
                      selectButton.disabled = false;
                  }

                  if (infoArea) { // OK: infoArea is HTMLElement | null
                      infoArea.innerHTML = `<strong>Selected:</strong> ${name || spec} (${spec})`;
                      infoArea.style.fontStyle = 'normal'; // OK
                  }
              });

              item.addEventListener('keydown', (e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                      item.click();
                      e.preventDefault();
                  }
                  // Fix 4: Check if next/previous element exists AND is an HTMLElement before calling focus()
                  else if (e.key === 'ArrowDown') {
                     const next = item.nextElementSibling;
                     if (next instanceof HTMLElement) { // Type guard
                         next.focus(); // OK: focus() is on HTMLElement
                     }
                     e.preventDefault();
                  } else if (e.key === 'ArrowUp') {
                     const prev = item.previousElementSibling;
                     if (prev instanceof HTMLElement) { // Type guard
                         prev.focus(); // OK
                     }
                     e.preventDefault();
                  }
              });

              list.appendChild(item);
          });

          container.appendChild(list);

          // Reset selection state if the previously selected item is no longer visible
          if (selectedSetSpec && !setEntries.some(([spec]) => spec === selectedSetSpec)) {
              selectedSetSpec = null;
              if (selectButton) selectButton.disabled = true;
               if (infoArea) { // OK: infoArea is HTMLElement | null
                   infoArea.textContent = "No set selected";
                   infoArea.style.fontStyle = 'italic'; // OK
               }
          }
           else if (selectButton) {
               selectButton.disabled = selectedSetSpec === null;
           }

      } catch (e: any) {
          console.error("Error updating sets list:", e);
          ztoolkit.log(`Error updating OAI sets list: ${e?.message || e}`, "error");
      }
  };
  // --- End function definition ---


  // Add title and description
  dialogHelper.addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: `Available Sets for ${endpointName}` },
      styles: { marginBottom: '10px' }
  });

  dialogHelper.addCell(1, 0, {
      tag: "p",
      properties: { innerHTML: `Select a set to filter OAI-PMH results (${Object.keys(sets).length} sets available):` },
      styles: { marginBottom: '10px' }
  });

  // Add search filter - NOW uses the pre-defined updateSetsList
  dialogHelper.addCell(2, 0, {
      tag: "div",
      namespace: "html",
      styles: { display: 'flex', gap: '10px', marginBottom: '10px' },
      children: [
          {
              tag: "label",
              namespace: "html",
              properties: { innerHTML: "Filter:" },
              styles: { width: '60px', lineHeight: '30px', flexShrink: 0 } // Prevent shrinking
          },
          {
              tag: "input",
              namespace: "html",
              id: "set-filter",
              attributes: { type: "text", placeholder: "Type to filter sets..." },
              styles: { flexGrow: 1, height: '30px', padding: '5px' },
              listeners: [{
                  type: "input",
                  // Listener now calls the function defined above
                  listener: (e: Event) => {
                    const target = e.target as HTMLInputElement; // Assert target is input
                    const filterValue = target.value;
                    const doc = target.ownerDocument; // Get document from target
                    if (!doc) return; // Should always exist, but check anyway

                    // Fix 5: Assert getElementById returns HTMLButtonElement or null
                    const selectButton = doc.getElementById("select") as HTMLButtonElement | null;
                    updateSetsList(doc, selectButton, filterValue); // Call the function
                }
              }]
          }
      ]
  });

  // Create the sets list container
  dialogHelper.addCell(3, 0, {
      tag: "div",
      namespace: "html",
      id: "sets-container",
      styles: {
          height: '400px', // Consider making this more dynamic or using flexbox
          overflowY: 'auto',
          border: '1px solid var(--ls-border-color, #ccc)',
          borderRadius: '4px',
          padding: '10px'
      }
  });

  // Add selection info area (using a new row)
  dialogHelper.addCell(4, 0, {
    tag: "div",
    namespace: "html",
    id: "selection-info", // Give it the ID here
    styles: {
        marginTop: '10px',
        padding: '5px 10px', // Add some padding
        borderTop: '1px solid var(--ls-border-color, #ccc)',
        fontStyle: 'italic',
        minHeight: '1.5em' // Prevent layout shifts
    },
    properties: {
        textContent: "No set selected" // Initial text
    }
});


  // Add buttons
  dialogHelper.addButton("Select", "select", {
      callback: () => {
          callback(selectedSetSpec); // Use the variable from the outer scope
          dialogHelper.window?.close();
      },
      noClose: true // Keep dialog open until explicitly closed
  });

  dialogHelper.addButton("Cancel", "cancel", {
      callback: () => {
          callback(null); // Indicate cancellation
          // Default button behavior closes the dialog unless noClose: true is set
      }
  });

  // Open the dialog
  const dialogWindow = dialogHelper.open("Available OAI Sets", {
      width: 700,
      height: 650 // Adjust as needed
  });

  // Initialize AFTER the dialog is open and DOM is ready
  if (dialogWindow && dialogWindow.window) {
    dialogWindow.window.addEventListener('DOMContentLoaded', () => {
        const doc = dialogWindow.window.document;
        // Fix 6: Assert getElementById returns HTMLButtonElement or null
        const selectButton = doc.getElementById("select") as HTMLButtonElement | null;
        if (selectButton) {
            selectButton.disabled = true;
        }

        // Selection info area is created by dialogHelper, no need to create/insert here

        // Initialize the list display
        updateSetsList(doc, selectButton);

    });
} else {
    ztoolkit.log("Error: OAI Sets Dialog window reference not found after open().", "error");
}
} // End of openSetsSelectionDialog

  // --- Set Initial Visibility ---
  ztoolkit.log(`${logPrefix} Setting initial visibility for protocol: ${dialogData.protocol}`);
  updateVisibility(dialogData.protocol);
  ztoolkit.log(`${logPrefix} Initial setup complete.`);

}); // End of DOMContentLoaded listener

  } else {
      ztoolkit.log("Initialization Error: dialogHelper.window is not available immediately after open().", "error");
  }

} // End of openSearchDialog