import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { LibrarySearchModule } from "./modules/librarySearch";

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

function registerLibrarySearchButton(win: _ZoteroTypes.MainWindow) {
  try {
    // Add a button to the toolbar
    const toolbarButton = ztoolkit.UI.createElement(win.document, "toolbarbutton", {
      namespace: "xul",
      properties: {
        id: `${addon.data.config.addonRef}-toolbar-button`,
        class: "zotero-tb-button",
        label: getString("toolbar-button-label"),
        tooltiptext: getString("toolbar-button-tooltip"),
        type: "button",
        hidden: false,
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

    // Add the button to Zotero's toolbar
    const toolbar = win.document.getElementById("zotero-toolbar");
    if (toolbar) {
      toolbar.appendChild(toolbarButton);
    }
  } catch (e) {
    ztoolkit.log('Error registering toolbar button:', e);
  }
}

function registerToolsMenuItem(win: _ZoteroTypes.MainWindow) {
  try {
    // Add to the tools menu using the plugin toolkit method
    const menuitem = ztoolkit.UI.createElement(win.document, "menuitem", {
      namespace: "xul",
      properties: {
        id: `${addon.data.config.addonRef}-menu-item`,
        label: getString("menu-item-label")
      }
    });
    
    // Add event listener directly
    menuitem.addEventListener("command", () => {
      addon.hooks.onDialogEvents("openSearch");
    });
    
    // Add to menu
    const toolsPopup = win.document.getElementById("menu_ToolsPopup");
    if (toolsPopup) {
      toolsPopup.appendChild(menuitem);
    }
  } catch (e) {
    ztoolkit.log('Error registering tools menu item:', e);
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  try {
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