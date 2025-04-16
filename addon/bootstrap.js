/* eslint-disable no-undef */

/**
 * Bootstrap script based on Zotero Plugin Template
 * https://github.com/windingwind/zotero-plugin-template
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  // String 'rootURI' introduced in Zotero 7
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "librarysearch", rootURI + "content/"],
    ["locale", "librarysearch", "en-US", rootURI + "locale/en-US/"],
  ]);

  /**
   * Global variables for plugin code.
   * The `_globalThis` is the global root variable of the plugin sandbox environment
   * and all child variables assigned to it is globally accessible.
   */
  const ctx = {
    rootURI,
  };
  ctx._globalThis = ctx;

  // Initialize Zotero.LibrarySearch if it doesn't exist
  if (!Zotero.LibrarySearch) {
    Zotero.LibrarySearch = {};
  }

  // Load the script
  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/librarysearch.js`,
    ctx,
  );
  
  // Transfer the addon object from the context to Zotero.LibrarySearch
  if (ctx.addon) {
    // Store a reference to the addon object
    Zotero.LibrarySearch.hooks = ctx.addon.hooks;
    Zotero.LibrarySearch.data = ctx.addon.data;
    
    // Run startup hook
    if (typeof Zotero.LibrarySearch.hooks?.onStartup === 'function') {
      Zotero.LibrarySearch.hooks.onStartup();
    }
  }
}

async function onMainWindowLoad({ window }, reason) {
  if (Zotero.LibrarySearch && typeof Zotero.LibrarySearch.hooks?.onMainWindowLoad === 'function') {
    Zotero.LibrarySearch.hooks.onMainWindowLoad(window);
  }
}

async function onMainWindowUnload({ window }, reason) {
  if (Zotero.LibrarySearch && typeof Zotero.LibrarySearch.hooks?.onMainWindowUnload === 'function') {
    Zotero.LibrarySearch.hooks.onMainWindowUnload(window);
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }
  
  if (Zotero.LibrarySearch && typeof Zotero.LibrarySearch.hooks?.onShutdown === 'function') {
    Zotero.LibrarySearch.hooks.onShutdown();
  }

  Cc["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  Cu.unload(`${rootURI}/content/scripts/librarysearch.js`);

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}