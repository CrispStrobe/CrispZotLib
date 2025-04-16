/**
 * preferenceScript.ts - Handles preference panel UI and functionality
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { PathUtils, ThemeUtils } from "../modules/themeUtils";
import { safeConsole } from "../utils/ztoolkit";

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

  // Try to detect Python path if not already set
  const currentPythonPath = getPref("pythonPath");
  if (!currentPythonPath) {
    detectAndSuggestPythonPath();
  }

  await updatePrefsUI();
  bindPrefEvents();
}

/**
 * Tries to detect Python path and suggests it to the user
 */
async function detectAndSuggestPythonPath() {
  try {
    // Check if we have a cached suggestion
    if (addon.data.suggestedPythonPath) {
      setPythonPathIfConfirmed(addon.data.suggestedPythonPath);
      return;
    }

    // Get default Miniconda path first
    let suggestedPath = "";
    const homePath = PathUtils.getUserHome();
    
    if (homePath) {
      if (Zotero.isMac) {
        suggestedPath = `${homePath}/miniconda3/bin/python`;
      } else if (Zotero.isWin) {
        suggestedPath = `${homePath}\\miniconda3\\python.exe`;
      } else {
        // Assume Linux
        suggestedPath = `${homePath}/miniconda3/bin/python`;
      }
      
      if (PathUtils.fileExists(suggestedPath)) {
        safeConsole.log(`Found Miniconda Python at: ${suggestedPath}`);
        setPythonPathIfConfirmed(suggestedPath);
        return;
      }
    }

    // Try to detect using system commands
    try {
      const detectedPath = await PathUtils.detectPythonPath();
      if (detectedPath) {
        // Cache the suggestion
        addon.data.suggestedPythonPath = detectedPath;
        setPythonPathIfConfirmed(detectedPath);
        return;
      }
    } catch (e) {
      safeConsole.log('Error detecting Python path:', e);
    }

    // If we still don't have a path, check other common paths
    for (const path of PathUtils.getDefaultPaths()) {
      if (PathUtils.fileExists(path)) {
        // Cache the suggestion
        addon.data.suggestedPythonPath = path;
        setPythonPathIfConfirmed(path);
        return;
      }
    }
    
    safeConsole.log('Could not detect Python path automatically');
  } catch (e) {
    safeConsole.log('Error in detectAndSuggestPythonPath:', e);
  }
}

/**
 * Sets the Python path after confirming with the user
 * @param path The Python path to suggest
 */
function setPythonPathIfConfirmed(path: string) {
  if (!addon.data.prefs?.window) return;

  const confirmMessage = `Python executable detected at:\n${path}\n\nWould you like to use this path?`;
  
  // Show confirmation dialog
  const useDetectedPath = addon.data.prefs.window.confirm(confirmMessage);
  
  if (useDetectedPath) {
    // Set the path in preferences
    setPref("pythonPath", path);
    
    // Update UI
    const pythonPathInput = addon.data.prefs.window.document?.getElementById(
      `zotero-prefpane-${config.addonRef}-python-path`
    ) as HTMLInputElement | null;
    
    if (pythonPathInput) {
      pythonPathInput.value = path;
    }
    
    // Update table
    if (addon.data.prefs?.rows) {
      addon.data.prefs.rows[0].value = path;
      // Force table refresh
      refreshTable();
    }
  }
}

/**
 * Updates the preferences UI with current values
 */
async function updatePrefsUI() {
  // Initialize UI elements on prefs window
  const renderLock = Zotero.Promise.defer();
  if (!addon.data.prefs?.window) return;

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
    
    // Add placeholder for Python path
    pythonPathInput.placeholder = "Python executable path (e.g. /usr/bin/python3)";
  }

  if (scriptPathInput) {
    scriptPathInput.value = getPref("scriptPath") || "";
    
    // Add placeholder for script path
    scriptPathInput.placeholder = "Path to library_search.py script";
  }

  // Add an auto-detect button for Python path
  const pythonPathContainer = document.querySelector(
    `#zotero-prefpane-${config.addonRef}-python-path`
  )?.parentElement;

  if (pythonPathContainer) {
    const autoDetectButton = document.createElement('button');
    autoDetectButton.textContent = 'Auto-detect';
    autoDetectButton.style.marginLeft = '5px';
    
    autoDetectButton.addEventListener('click', async (e) => {
      try {
        // Disable the button while detecting
        autoDetectButton.disabled = true;
        autoDetectButton.textContent = 'Detecting...';
        
        // Try to detect Python path
        const detectedPath = await PathUtils.detectPythonPath();
        
        if (detectedPath) {
          // Ask user if they want to use this path
          setPythonPathIfConfirmed(detectedPath);
        } else {
          // No path found
          if (addon.data.prefs?.window) {
            addon.data.prefs.window.alert('Could not automatically detect Python. Please set the path manually.');
          }
        }
      } catch (e) {
        safeConsole.log('Error in auto-detect:', e);
        if (addon.data.prefs?.window) {
          addon.data.prefs.window.alert('Error detecting Python: ' + e);
        }
      } finally {
        // Re-enable the button
        autoDetectButton.disabled = false;
        autoDetectButton.textContent = 'Auto-detect';
      }
    });
    
    // Add the button after the browse button
    pythonPathContainer.appendChild(autoDetectButton);
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
  safeConsole.log("Preference table rendered!");
}

/**
 * Binds events to preference UI elements
 */
function bindPrefEvents() {
  if (!addon.data.prefs || !addon.data.prefs.window || !addon.data.prefs.window.document) {
    return;
  }
  
  const document = addon.data.prefs.window.document;
  
  // Python path input
  const pythonPathInput = document.querySelector(
    `#zotero-prefpane-${config.addonRef}-python-path`
  );
  if (pythonPathInput) {
    pythonPathInput.addEventListener("change", (e: Event) => {
      const input = e.target as HTMLInputElement;
      Zotero.debug("Python path changed to: " + input.value);
      setPref("pythonPath", input.value);
      if (addon.data.prefs?.rows) {
        addon.data.prefs.rows[0].value = input.value;
        refreshTable();
      }
    });
  }
  
  // Browse Python button
  const browsePythonButton = document.querySelector(
    `#zotero-prefpane-${config.addonRef}-browse-python`
  );
  if (browsePythonButton) {
    Zotero.debug("Adding click listener to browse Python button");
    browsePythonButton.addEventListener("click", async (e: Event) => {
      e.preventDefault();
      Zotero.debug("Browse Python button clicked");
      try {
        const path = await selectFilePath("executable");
        Zotero.debug("Selected Python path: " + path);
        if (path) {
          const input = document.querySelector(
            `#zotero-prefpane-${config.addonRef}-python-path`
          ) as HTMLInputElement;
          if (input) {
            input.value = path;
            setPref("pythonPath", path);
            if (addon.data.prefs?.rows) {
              addon.data.prefs.rows[0].value = path;
              refreshTable();
            }
          }
        }
      } catch (error) {
        Zotero.debug("Error selecting Python path: " + error);
        if (addon.data.prefs?.window) {
          addon.data.prefs.window.alert("Error selecting Python path: " + error);
        }
      }
    });
  } else {
    Zotero.debug("Browse Python button not found");
  }
  
  // Script path input
  const scriptPathInput = document.querySelector(
    `#zotero-prefpane-${config.addonRef}-script-path`
  );
  if (scriptPathInput) {
    scriptPathInput.addEventListener("change", (e: Event) => {
      const input = e.target as HTMLInputElement;
      Zotero.debug("Script path changed to: " + input.value);
      setPref("scriptPath", input.value);
      if (addon.data.prefs?.rows) {
        addon.data.prefs.rows[1].value = input.value;
        refreshTable();
      }
    });
  }
  
  // Browse Script button
  const browseScriptButton = document.querySelector(
    `#zotero-prefpane-${config.addonRef}-browse-script`
  );
  if (browseScriptButton) {
    Zotero.debug("Adding click listener to browse script button");
    browseScriptButton.addEventListener("click", async (e: Event) => {
      e.preventDefault();
      Zotero.debug("Browse script button clicked");
      try {
        const path = await selectFilePath("file");
        Zotero.debug("Selected script path: " + path);
        if (path) {
          const input = document.querySelector(
            `#zotero-prefpane-${config.addonRef}-script-path`
          ) as HTMLInputElement;
          if (input) {
            input.value = path;
            setPref("scriptPath", path);
            if (addon.data.prefs?.rows) {
              addon.data.prefs.rows[1].value = path;
              refreshTable();
            }
          }
        }
      } catch (error) {
        Zotero.debug("Error selecting script path: " + error);
        if (addon.data.prefs?.window) {
          addon.data.prefs.window.alert("Error selecting script path: " + error);
        }
      }
    });
  } else {
    Zotero.debug("Browse script button not found");
  }
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
  ) as XUL.Tree | null;
  
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
      safeConsole.log('Error refreshing table:', e);
    }
  }
}

/**
 * Simplified file selection function using native Zotero APIs
 * @param type "file" or "executable"
 * @returns Promise resolving to selected path or undefined if canceled
 */
async function selectFilePath(type: "executable" | "file"): Promise<string | undefined> {
  try {
    Zotero.debug("Using Zotero's FilePicker for " + type);
    
    // Import Zotero's FilePicker
    const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    
    // Create a new file picker
    const fp = new FilePicker();
    
    // Initialize with appropriate mode
    fp.init(
      Zotero.getMainWindow(),
      type === "executable" ? "Select Python Executable" : "Select Python Script", 
      fp.modeOpen
    );
    
    // Set filters
    if (type === "executable") {
      if (Zotero.isWin) {
        fp.appendFilter("Executable", "*.exe");
      }
      fp.appendFilters(fp.filterAll);
    } else {
      fp.appendFilter("Python Scripts", "*.py");
      fp.appendFilters(fp.filterAll);
    }
    
    // Show the picker
    const rv = await fp.show();
    
    if (rv === fp.returnOK) {
      // Use type assertion to handle the file property correctly
      const file = fp.file as { path?: string } | null;
      if (file && typeof file.path === 'string') {
        const path = file.path;
        Zotero.debug("File selected: " + path);
        return path;
      } else {
        // Try alternative property access methods for the file path
        try {
          // Some versions might use .mozFile or .nativeFile with .path
          const nativeFile = (fp as any).nativeFile || (fp as any).mozFile || (fp as any).file;
          if (nativeFile) {
            if (typeof nativeFile.path === 'string') {
              return nativeFile.path;
            } else if (typeof nativeFile.leafName === 'string' && typeof nativeFile.parent?.path === 'string') {
              return nativeFile.parent.path + '/' + nativeFile.leafName;
            }
          }
        } catch (e) {
          Zotero.debug("Error accessing file path through alternative methods: " + e);
        }
      }
    }
    
    Zotero.debug("No file selected or dialog cancelled");
    return undefined;
  } catch (e) {
    Zotero.debug("Error in Zotero FilePicker: " + e);
    
    // Fall back to a simpler approach with fewer TypeScript concerns
    try {
      // Try using the older nsIFilePicker API with proper type assertions
      const fp = Components.classes["@mozilla.org/filepicker;1"]
        .createInstance(Components.interfaces.nsIFilePicker);
      
      const win = Zotero.getMainWindow();
      if (!win) {
        throw new Error("Could not get main window");
      }
      
      fp.init(
        win,
        type === "executable" ? "Select Python Executable" : "Select Python Script",
        Components.interfaces.nsIFilePicker.modeOpen
      );
      
      if (type === "executable") {
        if (Zotero.isWin) {
          fp.appendFilter("Executable", "*.exe");
        }
        fp.appendFilter("All Files", "*");
      } else {
        fp.appendFilter("Python Scripts", "*.py");
        fp.appendFilter("All Files", "*");
      }
      
      // Try synchronous approach first
      const rv = fp.show();
      if (rv === Components.interfaces.nsIFilePicker.returnOK) {
        // Use type assertion for nsIFile
        const nsFile = fp.file as { path: string } | null;
        if (nsFile && typeof nsFile.path === 'string') {
          return nsFile.path;
        }
      }
      
      return undefined;
    } catch (e2) {
      Zotero.debug("All file picker methods failed: " + e2);
      throw new Error("Could not open file picker: " + e);
    }
  }
}