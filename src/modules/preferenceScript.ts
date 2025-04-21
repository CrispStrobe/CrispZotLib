/**
* preferenceScript.ts - Handles preference panel UI and functionality
* (Updated for TypeScript-based Library Search implementation)
*/

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
    ) as HTMLInputElement;
    
    if (enableCheckbox) {
      enableCheckbox.checked = getPref("enable");
      
      // Add event listener
      enableCheckbox.addEventListener("change", function() {
        setPref("enable", enableCheckbox.checked);
      });
    }
    
    // Display settings in a simple table instead of VirtualizedTable
    if (addon.data.prefs) {
      const container = win.document.getElementById("__addonRef__-table-container");
      if (container) {
        // Remove any existing content
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        
        // Create a simple HTML table
        const table = win.document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";
        
        // Create header row
        const thead = win.document.createElement("thead");
        const headerRow = win.document.createElement("tr");
        
        for (const column of addon.data.prefs.columns) {
          const th = win.document.createElement("th");
          th.textContent = column.label;
          th.style.textAlign = "left";
          th.style.padding = "8px";
          th.style.borderBottom = "1px solid #ccc";
          
          if (column.fixedWidth) {
            th.style.width = `${column.width}px`;
          }
          
          headerRow.appendChild(th);
        }
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body with rows
        const tbody = win.document.createElement("tbody");
        
        for (const row of addon.data.prefs.rows) {
          const tr = win.document.createElement("tr");
          
          for (const column of addon.data.prefs.columns) {
            const td = win.document.createElement("td");
            td.textContent = row[column.dataKey];
            td.style.padding = "8px";
            td.style.borderBottom = "1px solid #eee";
            tr.appendChild(td);
          }
          
          tbody.appendChild(tr);
        }
        
        table.appendChild(tbody);
        container.appendChild(table);
      }
    }
  } catch (e) {
    ztoolkit.log("Error updating preferences UI:", e);
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