/**
 * Bootstrap script for Library Search plugin
 * Based on Zotero's official examples and best practices
 */

var chromeHandle;

// Install is called when the extension is installed
function install(data, reason) {}

// Startup is called when Zotero starts or when the extension is enabled
async function startup({ id, version, resourceURI, rootURI }, reason) {
  // In Zotero 7, we can use await directly because bootstrap methods aren't called
  // until Zotero is initialized
  if (typeof Zotero !== "undefined") {
    await Zotero.initializationPromise;
  } else {
    // Zotero 6 compatibility - wait for Zotero to be available
    await waitForZotero();
  }
  
  // String 'rootURI' introduced in Zotero 7
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }
  
  // Register chrome
  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "librarysearch", rootURI + "content/"],
    ["locale", "librarysearch", "en-US", rootURI + "locale/en-US/"],
    ["locale", "librarysearch", "zh-CN", rootURI + "locale/zh-CN/"]
  ]);
  
  // Create a sandbox for our code
  const ctx = {};
  ctx.rootURI = rootURI;
  ctx._globalThis = ctx;
  ctx.window = Zotero.getMainWindow();
  ctx.document = ctx.window?.document;
  
  // If Zotero.LibrarySearch already exists, don't initialize again
  if (!Zotero.LibrarySearch || !Zotero.LibrarySearch.initialized) {
    // Load the main script
    Zotero.debug("[LibrarySearch] Loading main script");
    Services.scriptloader.loadSubScript(
      rootURI + "content/scripts/librarysearch.js",
      ctx
    );
    
    // Set initialized flag to prevent double initialization
    if (Zotero.LibrarySearch) {
      Zotero.LibrarySearch.initialized = true;
    }
    
    // Call startup hook if available
    if (Zotero.LibrarySearch?.hooks?.onStartup) {
      try {
        await Zotero.LibrarySearch.hooks.onStartup();
      } catch (e) {
        Zotero.debug("[LibrarySearch] Error in startup hook: " + e);
      }
    }
  } else {
    Zotero.debug("[LibrarySearch] Already initialized, skipping");
  }
}

// Shutdown is called when Zotero shuts down or when the extension is disabled
function shutdown({ id, version, resourceURI, rootURI }, reason) {
  // Don't do anything during application shutdown
  if (reason === APP_SHUTDOWN) {
    return;
  }
  
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"]
      .getService(Components.interfaces.nsISupports)
      .wrappedJSObject;
  }
  
  // Call shutdown hook if available
  if (Zotero.LibrarySearch?.hooks?.onShutdown) {
    try {
      Zotero.LibrarySearch.hooks.onShutdown();
    } catch (e) {
      Zotero.debug("[LibrarySearch] Error in shutdown hook: " + e);
    }
  }
  
  // Flush string bundles cache
  Components.classes["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();
  
  // Unload script
  try {
    Components.utils.unload(rootURI + "content/scripts/librarysearch.js");
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error unloading script: " + e);
  }
  
  // Clean up chrome handle
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
  
  // Clear reference to our plugin
  delete Zotero.LibrarySearch;
}

// Uninstall is called when the extension is uninstalled
function uninstall(data, reason) {}

// Helper function for Zotero 6 compatibility
async function waitForZotero() {
  const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
  
  // Check if Zotero is already available
  let win = Services.wm.getMostRecentWindow("navigator:browser");
  if (win && win.Zotero) {
    Zotero = win.Zotero;
    return;
  }
  
  // Wait for a Zotero window
  await new Promise(resolve => {
    var listener = {
      onOpenWindow(aWindow) {
        // Wait for the window to finish loading
        const domWindow = aWindow
          .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
          .getInterface(Components.interfaces.nsIDOMWindowInternal || 
                        Components.interfaces.nsIDOMWindow);
        
        const onLoad = function() {
          domWindow.removeEventListener("load", onLoad, false);
          if (domWindow.Zotero) {
            Services.wm.removeListener(listener);
            Zotero = domWindow.Zotero;
            resolve();
          }
        };
        domWindow.addEventListener("load", onLoad, false);
      }
    };
    Services.wm.addListener(listener);
  });
  
  // Wait for Zotero initialization
  if (Zotero.initializationPromise) {
    await Zotero.initializationPromise;
  }
}