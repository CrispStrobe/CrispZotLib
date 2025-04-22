// src/modules/preferenceScript.ts

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { ThemeUtils } from "../modules/themeUtils";

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [
        {
          dataKey: "setting",
          label: getString("prefs-table-setting"),
          fixedWidth: true,
          width: 150,
        },
        {
          dataKey: "value",
          label: getString("prefs-table-value"),
        },
      ],
      rows: [
        {
          setting: "Enabled",
          value: getPref("enable") ? "Yes" : "No"
        },
        {
          setting: "Debug Mode",
          value: getPref("debugMode") ? "Enabled" : "Disabled"
        }
        // You can add other plugin settings here
      ],
    };
  } else {
    addon.data.prefs.window = _window;
  }

  // Apply theme to the preferences window
  ThemeUtils.applyTheme(_window);

  // Set up theme change observer
  const themeObserver = ThemeUtils.observeThemeChanges((isDarkMode) => {
    if (addon.data.prefs?.window) {
      ThemeUtils.applyTheme(addon.data.prefs.window);
    }
  });

  // Store the observer in addon data so it can be cleaned up later
  addon.data.themeObserver = themeObserver;

  await updatePrefsUI();
  bindPrefEvents();
}

/**
* Update the preferences UI with current values
*/
async function updatePrefsUI() {
  try {
    const win = addon.data.prefs?.window;
    if (!win) return;

    // Update the enabled checkbox
    const enableCheckbox = win.document.getElementById(
      "zotero-prefpane-__addonRef__-enable"
    ) as HTMLInputElement | null; // Keep the null check possibility

    if (enableCheckbox) {
      // --- FIX 1: Explicitly convert to boolean ---
      enableCheckbox.checked = Boolean(getPref("enable"));

      // Add event listener (check if it already exists to avoid duplicates if called multiple times)
      // A simple way is to remove first, then add. Or use a flag.
      enableCheckbox.removeEventListener("change", handleEnableChange); // Use named function
      enableCheckbox.addEventListener("change", handleEnableChange);    // Use named function
    }

    // Add debug mode checkbox (Consider checking if it already exists)
    let debugCheckbox = win.document.getElementById("zotero-prefpane-__addonRef__-debug") as HTMLInputElement | null;
    let checkboxContainer = debugCheckbox?.parentElement; // Try to find existing container

    if (!debugCheckbox) {
      // Only create if it doesn't exist
      checkboxContainer = win.document.createElement("div");

      // --- FIX: Assert the type before accessing style ---
      // Since we just created it as a div, we know it's an HTMLElement (specifically HTMLDivElement)
      (checkboxContainer as HTMLElement).style.margin = "10px 0";
      // Or more specifically:
      // (checkboxContainer as HTMLDivElement).style.margin = "10px 0";


      debugCheckbox = win.document.createElement("input");
      debugCheckbox.type = "checkbox";
      debugCheckbox.id = "zotero-prefpane-__addonRef__-debug";

      const debugLabel = win.document.createElement("label");
      debugLabel.htmlFor = "zotero-prefpane-__addonRef__-debug";
      debugLabel.textContent = "Enable Debug Mode"; // Consider using getString()
      debugLabel.style.marginLeft = "5px";

      // Append children to the newly created container
      checkboxContainer.appendChild(debugCheckbox);
      checkboxContainer.appendChild(debugLabel);

      // Find the container to add the debug checkbox
      const container = win.document.querySelector(".prefpane-container");
      if (container) {
        // Insert after the enable checkbox if possible, or append
        const enableContainer = enableCheckbox?.closest('div, p, setting'); // Find enable checkbox container
        if (enableContainer?.parentNode === container && enableContainer.nextSibling) {
          container.insertBefore(checkboxContainer, enableContainer.nextSibling);
        } else {
          container.appendChild(checkboxContainer);
        }
      }
    } else if (checkboxContainer instanceof HTMLElement) {
        // Optional: If you need to style the existing container found via parentElement
        // checkboxContainer.style.margin = "10px 0"; // Apply style if needed
    }


    // --- FIX 2: Explicitly convert to boolean ---
    // Ensure debugCheckbox is not null here before accessing checked
    if (debugCheckbox) {
        debugCheckbox.checked = Boolean(getPref("debugMode"));

        // Add event listener (check if it already exists)
        debugCheckbox.removeEventListener("change", handleDebugChange); // Use named function
        debugCheckbox.addEventListener("change", handleDebugChange);    // Use named function
    }

    // Display settings in a simple table instead of VirtualizedTable
    if (addon.data.prefs) {
      const tableContainer = win.document.getElementById("__addonRef__-table-container");
      if (tableContainer) {
        // Remove any existing content
        while (tableContainer.firstChild) {
          tableContainer.removeChild(tableContainer.firstChild);
        }

        // Create a simple HTML table
        const table = win.document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";
        table.classList.add("prefs-table"); // Add a class for potential styling

        // Create header row
        const thead = win.document.createElement("thead");
        const headerRow = win.document.createElement("tr");

        for (const column of addon.data.prefs.columns) {
          const th = win.document.createElement("th");
          th.textContent = column.label;
          th.style.textAlign = "left";
          th.style.padding = "8px";
          th.style.borderBottom = "1px solid var(--border-color, #ccc)"; // Use CSS variable

          if (column.fixedWidth) {
            th.style.width = `${column.width}px`;
          }

          headerRow.appendChild(th);
        }

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body with rows (Update rows based on current prefs)
        addon.data.prefs.rows = [ // Rebuild rows data here
           {
             setting: "Enabled", // Consider using getString()
             value: Boolean(getPref("enable")) ? "Yes" : "No" // Use Boolean() here too
           },
           {
             setting: "Debug Mode", // Consider using getString()
             value: Boolean(getPref("debugMode")) ? "Enabled" : "Disabled" // Use Boolean() here too
           }
           // Add other settings dynamically if needed
        ];

        const tbody = win.document.createElement("tbody");
        for (const rowData of addon.data.prefs.rows) {
          const tr = win.document.createElement("tr");

          for (const column of addon.data.prefs.columns) {
            const td = win.document.createElement("td");
            // Ensure dataKey exists and handle potential undefined
            td.textContent = String(rowData[column.dataKey] ?? '');
            td.style.padding = "8px";
            td.style.borderBottom = "1px solid var(--border-color-light, #eee)"; // Use CSS variable
            tr.appendChild(td);
          }

          tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        tableContainer.appendChild(table);
      }
    }
  } catch (e) {
    // Use ztoolkit or console.error based on your setup
    console.error("Error updating preferences UI:", e);
    // ztoolkit.log("Error updating preferences UI:", e);
  }
}

// --- Helper functions for event listeners ---
function handleEnableChange(event: Event) {
  const target = event.target as HTMLInputElement;
  setPref("enable", target.checked);
  updatePrefsTable(); // Update table when changed
}

function handleDebugChange(event: Event) {
  const target = event.target as HTMLInputElement;
  setPref("debugMode", target.checked);
  updatePrefsTable(); // Update table when changed
}

// --- Helper function to update table data ---
function updatePrefsTable() {
   const win = addon.data.prefs?.window;
   if (!win || !addon.data.prefs) return;

   const tableContainer = win.document.getElementById("__addonRef__-table-container");
   const tbody = tableContainer?.querySelector("tbody");
   if (!tbody) return;

   // Update rows data source
   addon.data.prefs.rows = [
      { setting: "Enabled", value: Boolean(getPref("enable")) ? "Yes" : "No" },
      { setting: "Debug Mode", value: Boolean(getPref("debugMode")) ? "Enabled" : "Disabled" }
   ];

   // Find and update corresponding cells in the existing table
   const rows = tbody.querySelectorAll("tr");
   for (const tr of rows) {
     const cells = tr.querySelectorAll("td");
     if (cells.length > 1) {
       const settingName = cells[0].textContent;
       const correspondingRowData = addon.data.prefs.rows.find(r => r.setting === settingName);
       if (correspondingRowData) {
         cells[1].textContent = String(correspondingRowData.value ?? '');
       }
     }
   }
}


/**
* Bind event handlers to preference UI elements
*/
function bindPrefEvents() {
  try {
    const win = addon.data.prefs?.window;
    if (!win) return;

    // Add any additional event bindings here

  } catch (e) {
    ztoolkit.log("Error binding preference events:", e);
  }
}