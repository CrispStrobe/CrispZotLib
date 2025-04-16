import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { LibrarySearchModule } from "./modules/librarySearch";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Register preferences
  registerPreferences();

  // Wait for main window to be ready
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
}

function registerPreferences() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // @ts-ignore This is a moz feature
  win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-mainWindow.ftl`);

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  await Zotero.Promise.delay(1000);
  popupWin.changeLine({
    progress: 50,
    text: `[50%] ${getString("startup-begin")}`,
  });

  // Register toolbar button
  registerLibrarySearchButton(win);

  // Add to the tools menu
  registerToolsMenuItem(win);

  await Zotero.Promise.delay(1000);
  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${getString("startup-finish")}`,
  });
  popupWin.startCloseTimer(5000);
}

function registerLibrarySearchButton(win: _ZoteroTypes.MainWindow) {
  // Add a button to the toolbar
  const toolbarButton = ztoolkit.UI.createElement(win.document, "toolbarbutton", {
    namespace: "xul",
    properties: {
      id: `${addon.data.config.addonRef}-toolbar-button`,
      class: "zotero-tb-button",
      label: getString("toolbar-button-label"),
      tooltiptext: getString("toolbar-button-tooltip"),
      type: "button",
      // Use this instead of calling the function directly
      onclick: "_globalThis.LibrarySearch.openSearch()",
      hidden: false,
    }
  });

  // Add the button to Zotero's toolbar
  const toolbar = win.document.getElementById("zotero-toolbar");
  if (toolbar) {
    toolbar.appendChild(toolbarButton);
  }
}

function registerToolsMenuItem(win: _ZoteroTypes.MainWindow) {
  // Add to the tools menu
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: `${addon.data.config.addonRef}-menu-item`,
    label: getString("menu-item-label"),
    oncommand: "_globalThis.LibrarySearch.openSearch()",
  });
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

async function onDialogEvents(type: string, data?: any) {
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
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onDialogEvents,
};