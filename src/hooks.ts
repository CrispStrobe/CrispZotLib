import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { LibrarySearchModule } from "./modules/librarySearch";
import { ThemeUtils } from "./modules/themeUtils";

async function onStartup() {
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    // Initialize the toolkit first to ensure logging works
    if (!addon.data.ztoolkit) {
      addon.data.ztoolkit = createZToolkit();
    }

    ztoolkit.log('Plugin starting up');
    
    // Initialize the LibrarySearchModule
    LibrarySearchModule.init();
    
    // Initialize locale
    initLocale();

    // Register preferences
    registerPreferences();

    // Wait for main window to be ready
    const mainWindows = Zotero.getMainWindows();
    if (mainWindows && mainWindows.length > 0) {
      await Promise.all(
        mainWindows.map((win) => onMainWindowLoad(win)),
      );
    } else {
      ztoolkit.log('No main windows found during startup');
    }
    
    ztoolkit.log('Plugin startup complete');
  } catch (e) {
    console.error('Error during LibrarySearch startup:', e);
  }
}

function registerPreferences() {
  try {
    Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    });
  } catch (e) {
    ztoolkit.log('Error registering preferences:', e);
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  try {
    // Make sure ztoolkit is initialized
    if (!addon.data.ztoolkit) {
      addon.data.ztoolkit = createZToolkit();
    }

    // Inject the CSS into the main window for dark mode support
    injectDarkModeCSS(win);

    // Load locale files
    try {
      // @ts-ignore This is a moz feature
      win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-mainWindow.ftl`);
    } catch (e) {
      ztoolkit.log('Error loading FTL file:', e);
    }

    const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 3000, // Close after 3 seconds
    })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

    try {
      // Register toolbar button
      registerLibrarySearchButton(win);

      // Add to the tools menu
      registerToolsMenuItem(win);

      // Set up theme change observer for main window
      const themeObserver = ThemeUtils.observeThemeChanges((isDarkMode) => {
        // Update theme-dependent UI elements if needed
        ztoolkit.log(`Theme changed to ${isDarkMode ? 'dark' : 'light'} mode`);
      });
      
      // Store the observer in addon data so it can be cleaned up later
      addon.data.mainThemeObserver = themeObserver;

      popupWin.changeLine({
        progress: 100,
        text: getString("startup-finish"),
      });
    } catch (e) {
      ztoolkit.log('Error setting up UI elements:', e);
      popupWin.changeLine({
        progress: 100,
        text: "Error initializing plugin UI",
        type: "error"
      });
    }
  } catch (e) {
    console.error('Error in onMainWindowLoad:', e);
  }
}

/**
 * Injects the dark mode CSS into the main window
 */
function injectDarkModeCSS(win: Window) {
  try {
    const doc = win.document;
    if (!doc) {
      ztoolkit.log('No document available to inject CSS into');
      return;
    }
    
    // Check if our style is already injected
    if (doc.getElementById('librarysearch-dark-mode-css')) {
      return;
    }
    
    // Create a style element
    const style = doc.createElement('style');
    style.id = 'librarysearch-dark-mode-css';
    style.textContent = `
      /* Dark mode support for Library Search plugin */
      :root {
        --ls-background-color: #ffffff;
        --ls-text-color: #000000;
        --ls-border-color: #cccccc;
        --ls-highlight-color: #f0f0f0;
        --ls-button-bg: #f0f0f0;
        --ls-button-text: #000000;
        --ls-button-hover: #e0e0e0;
        --ls-dialog-bg: #ffffff;
        --ls-dialog-text: #000000;
        --ls-link-color: #0366d6;
        --ls-result-bg: #ffffff;
        --ls-result-border: #e0e0e0;
      }
      
      /* Dark mode variables - will be applied when Zotero is in dark mode */
      [data-theme="dark"] {
        --ls-background-color: #2a2a2e;
        --ls-text-color: #f9f9fa;
        --ls-border-color: #4a4a4f;
        --ls-highlight-color: #3a3a40;
        --ls-button-bg: #4a4a4f;
        --ls-button-text: #f9f9fa;
        --ls-button-hover: #5a5a5f;
        --ls-dialog-bg: #38383d;
        --ls-dialog-text: #f9f9fa;
        --ls-link-color: #45a1ff;
        --ls-result-bg: #2a2a2e;
        --ls-result-border: #4a4a4f;
      }
    `;
    
    // Add it to the document
    if (doc.head) {
      doc.head.appendChild(style);
      ztoolkit.log('Injected dark mode CSS into main window');
    } else {
      ztoolkit.log('Could not find document head to inject CSS');
    }
  } catch (e) {
    ztoolkit.log('Error injecting dark mode CSS:', e);
  }
}

function registerLibrarySearchButton(win: _ZoteroTypes.MainWindow) {
  try {
    if (!win.document) {
      ztoolkit.log("No document available to register toolbar button");
      return;
    }
    
    const toolbarButton = ztoolkit.UI.createElement(win.document, "toolbarbutton", {
      namespace: "xul",
      properties: {
        id: `${addon.data.config.addonRef}-toolbar-button`,
        class: "zotero-tb-button",
        label: "Search Libraries", // Direct string instead of getString
        tooltiptext: "Search library catalogs and repositories", // Direct string
        type: "button",
        hidden: false
      },
      listeners: [
        {
          type: "command",
          listener: () => {
            addon.hooks.onDialogEvents("openSearch");
          }
        }
      ]
    });
    
    const toolbar = win.document.getElementById("zotero-toolbar");
    if (toolbar) {
      toolbar.appendChild(toolbarButton);
    } else {
      ztoolkit.log("Could not find zotero-toolbar element");
    }
  } catch (e) {
    ztoolkit.log("Error registering toolbar button:", e);
  }
}

function registerToolsMenuItem(win: _ZoteroTypes.MainWindow) {
  try {
    if (!win.document) {
      ztoolkit.log("No document available to register menu item");
      return;
    }
    
    const menuitem = ztoolkit.UI.createElement(win.document, "menuitem", {
      namespace: "xul",
      properties: {
        id: `${addon.data.config.addonRef}-menu-item`,
        label: "Library Search" // Direct string instead of getString
      }
    });
    
    menuitem.addEventListener("command", () => {
      addon.hooks.onDialogEvents("openSearch");
    });
    
    const toolsPopup = win.document.getElementById("menu_ToolsPopup");
    if (toolsPopup) {
      toolsPopup.appendChild(menuitem);
    } else {
      ztoolkit.log("Could not find menu_ToolsPopup element");
    }
  } catch (e) {
    ztoolkit.log("Error registering tools menu item:", e);
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  try {
    // Disconnect theme observers
    if (addon.data.mainThemeObserver) {
      addon.data.mainThemeObserver.disconnect();
      addon.data.mainThemeObserver = undefined;
    }
    
    ztoolkit.unregisterAll();
    if (addon.data.dialog?.window && !addon.data.dialog.window.closed) {
      addon.data.dialog.window.close();
    }
  } catch (e) {
    console.error('Error in onMainWindowUnload:', e);
  }
}

function onShutdown(): void {
  try {
    ztoolkit.log('Plugin shutting down');
    
    // Disconnect all theme observers
    if (addon.data.mainThemeObserver) {
      addon.data.mainThemeObserver.disconnect();
    }
    
    if (addon.data.themeObserver) {
      addon.data.themeObserver.disconnect();
    }
    
    ztoolkit.unregisterAll();
    
    if (addon.data.dialog?.window && !addon.data.dialog.window.closed) {
      addon.data.dialog.window.close();
    }
    
    // Remove addon object
    addon.data.alive = false;
    
    // Clean up Zotero.<addonInstance> - use type assertion
    if ((Zotero as any).LibrarySearch) {
      delete (Zotero as any).LibrarySearch;
    }
  } catch (e) {
    console.error('Error during plugin shutdown:', e);
  }
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  try {
    switch (type) {
      case "load":
        registerPrefsScripts(data.window);
        break;
      default:
        return;
    }
  } catch (e) {
    ztoolkit.log('Error in onPrefsEvent:', e);
  }
}

async function onDialogEvents(type: string, data?: any) {
  try {
    switch (type) {
      case "openSearch":
        await LibrarySearchModule.openSearchDialog();
        break;
      case "runSearch":
        if (data) {
          const results = await LibrarySearchModule.runSearch(data);
          return results;
        }
        break;
      case "importResults":
        if (data) {
          await LibrarySearchModule.importResults(data);
        }
        break;
      case "executeCommand":
        if (data && data.command) {
          const result = await LibrarySearchModule.executeCommand(data.command, data.args || []);
          return result;
        }
        break;
      default:
        break;
    }
  } catch (e) {
    ztoolkit.log('Error in onDialogEvents:', e);
    throw e; // Rethrow to allow handling by caller
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onDialogEvents,
};