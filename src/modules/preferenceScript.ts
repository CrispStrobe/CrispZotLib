import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
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
          setting: "Python Path",
          value: getPref("pythonPath") || ""
        },
        {
          setting: "Script Path",
          value: getPref("scriptPath") || ""
        }
      ],
    };
  } else {
    addon.data.prefs.window = _window;
  }

  updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  // You can initialize some UI elements on prefs window
  // with addon.data.prefs.window.document
  // Or bind some events to the elements
  const renderLock = ztoolkit.getGlobal("Zotero").Promise.defer();
  if (addon.data.prefs?.window == undefined) return;

  // Get input elements
  const prefsWindow = addon.data.prefs.window;
  const document = prefsWindow.document;
  if (!document) return;

  const pythonPathInput = document.getElementById(
    `zotero-prefpane-${config.addonRef}-python-path`
  ) as HTMLInputElement | null;

  const scriptPathInput = document.getElementById(
    `zotero-prefpane-${config.addonRef}-script-path`
  ) as HTMLInputElement | null;

  // Set current values
  if (pythonPathInput) {
    pythonPathInput.value = getPref("pythonPath") || "";
  }

  if (scriptPathInput) {
    scriptPathInput.value = getPref("scriptPath") || "";
  }

  // Show settings in a table
  const tableHelper = new ztoolkit.VirtualizedTable(addon.data.prefs?.window)
    .setContainerId(`${config.addonRef}-table-container`)
    .setProp({
      id: `${config.addonRef}-prefs-table`,
      columns: addon.data.prefs?.columns,
      showHeader: true,
      multiSelect: false,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => addon.data.prefs?.rows.length || 0)
    .setProp(
      "getRowData",
      (index) =>
        addon.data.prefs?.rows[index] || {
          setting: "unknown",
          value: "unknown",
        },
    )
    // Render the table
    .render(-1, () => {
      renderLock.resolve();
    });

  await renderLock.promise;
  ztoolkit.log("Preference table rendered!");
}

function bindPrefEvents() {
  if (!addon.data.prefs || !addon.data.prefs.window || !addon.data.prefs.window.document) {
    return;
  }

  const document = addon.data.prefs.window.document;

  // Python path input
  document.querySelector(
    `#zotero-prefpane-${config.addonRef}-python-path`,
  )?.addEventListener("change", (e: Event) => {
    const input = e.target as HTMLInputElement;
    setPref("pythonPath", input.value);

    // Update table row value
    if (addon.data.prefs?.rows) {
      addon.data.prefs.rows[0].value = input.value;
      // Force table refresh
      refreshTable();
    }
  });

  // Browse button for Python path
  document.querySelector(
    `#zotero-prefpane-${config.addonRef}-browse-python`,
  )?.addEventListener("command", async (e: Event) => {
    try {
      const filePath = await browsePath("executable");
      if (filePath) {
        const input = document.querySelector(
          `#zotero-prefpane-${config.addonRef}-python-path`,
        ) as HTMLInputElement | null;

        if (input) {
          input.value = filePath;
          setPref("pythonPath", filePath);

          // Update table row value
          if (addon.data.prefs?.rows) {
            addon.data.prefs.rows[0].value = filePath;
            // Force table refresh
            refreshTable();
          }
        }
      }
    } catch (error) {
      ztoolkit.log("Error selecting Python path:", error);
    }
  });

  // Script path input
  document.querySelector(
    `#zotero-prefpane-${config.addonRef}-script-path`,
  )?.addEventListener("change", (e: Event) => {
    const input = e.target as HTMLInputElement;
    setPref("scriptPath", input.value);

    // Update table row value
    if (addon.data.prefs?.rows) {
      addon.data.prefs.rows[1].value = input.value;
      // Force table refresh
      refreshTable();
    }
  });

  // Browse button for script path
  document.querySelector(
    `#zotero-prefpane-${config.addonRef}-browse-script`,
  )?.addEventListener("command", async (e: Event) => {
    try {
      const filePath = await browsePath("file");
      if (filePath) {
        const input = document.querySelector(
          `#zotero-prefpane-${config.addonRef}-script-path`,
        ) as HTMLInputElement | null;

        if (input) {
          input.value = filePath;
          setPref("scriptPath", filePath);

          // Update table row value
          if (addon.data.prefs?.rows) {
            addon.data.prefs.rows[1].value = filePath;
            // Force table refresh
            refreshTable();
          }
        }
      }
    } catch (error) {
      ztoolkit.log("Error selecting script path:", error);
    }
  });
}

/**
 * Helper function to refresh the table display
 */
function refreshTable() {
  if (!addon.data.prefs || !addon.data.prefs.window || !addon.data.prefs.window.document) {
    return;
  }
  
  const tableElem = addon.data.prefs.window.document.getElementById(
    `${config.addonRef}-prefs-table`
  ) as XUL.Tree;
  
  if (tableElem) {
    // Force table refresh using appropriate method
    try {
      // Try modern approach
      if (typeof (tableElem as any).invalidate === 'function') {
        (tableElem as any).invalidate();
      } 
      // Fallback for legacy Zotero versions - using any type to bypass TypeScript checking
      else if ((tableElem as any).builder && typeof (tableElem as any).builder.rebuild === 'function') {
        (tableElem as any).builder.rebuild();
      }
    } catch (e) {
      ztoolkit.log('Error refreshing table:', e);
    }
  }
}

/**
 * Helper function to browse for a file path
 * @param type "file" or "executable"
 */
async function browsePath(type: "file" | "executable"): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    try {
      // Use 'any' to bypass TypeScript Component.classes checking
      const cc = Components.classes as any;
      const ci = Components.interfaces;
      
      const filePicker = cc["@mozilla.org/filepicker;1"]
        .createInstance(ci.nsIFilePicker);
      
      const window = ztoolkit.getGlobal("Zotero").getMainWindow();
      filePicker.init(window, 
        type === "executable" ? "Select Python Executable" : "Select Search Script", 
        ci.nsIFilePicker.modeOpen);
      
      // Set file picker filters
      if (type === "executable") {
        // For Python executable
        if (Zotero.isWin) {
          filePicker.appendFilter("Executable", "*.exe");
        } else {
          filePicker.appendFilter("All Files", "*");
        }
      } else {
        // For Python script
        filePicker.appendFilter("Python Files", "*.py");
        filePicker.appendFilter("All Files", "*");
      }
      
      const result = filePicker.open();
      if (result === ci.nsIFilePicker.returnOK) {
        resolve(filePicker.file.path);
      } else {
        resolve(undefined);
      }
    } catch (error) {
      reject(error);
    }
  });
}