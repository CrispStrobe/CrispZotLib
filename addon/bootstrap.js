/* eslint-disable no-undef */

/**
 * Bootstrap script based on Zotero Plugin Template
 * https://github.com/windingwind/zotero-plugin-template
 */

var chromeHandle;

// Store any variables we need to track across the bootstrap lifecycle
var BOOTSTRAP_FIXES = {
  installed: false
};

/**
 * Apply runtime fixes early before the main script loads
 */
function applyRuntimeFixes(rootURI) {
  try {
    if (typeof Zotero === 'undefined') {
      Components.utils.import("resource://zotero/bootstrap.js");
    }
    
    if (typeof Zotero !== 'undefined') {
      Zotero.debug("[LibrarySearch] Loading bootstrap fixes...");
      
      // Setup console if needed
      if (typeof console === 'undefined') {
        this.console = {
          log: function() { Zotero.debug(Array.from(arguments).join(' ')); },
          warn: function() { Zotero.debug('[WARN] ' + Array.from(arguments).join(' ')); },
          error: function() { Zotero.debug('[ERROR] ' + Array.from(arguments).join(' ')); },
          info: function() { Zotero.debug('[INFO] ' + Array.from(arguments).join(' ')); },
          trace: function() { Zotero.debug('[TRACE] ' + Array.from(arguments).join(' ')); }
        };
      } else if (typeof console.trace !== 'function') {
        console.trace = function() { 
          Zotero.debug('[TRACE] ' + Array.from(arguments).join(' ')); 
        };
      }

      // Fix window2 and globalThis
      try {
        // Get the main window
        const mainWindow = Zotero.getMainWindow();
        if (mainWindow) {
          // Define window2 on the main window
          if (!mainWindow.window2) {
            Object.defineProperty(mainWindow, 'window2', {
              get: function() { return mainWindow; },
              configurable: true
            });
            Zotero.debug("[LibrarySearch] window2 reference added to main window");
          }
          
          // Patch globalThis.addEventListener if it doesn't exist
          if (typeof globalThis !== 'undefined' && !globalThis.addEventListener && mainWindow.addEventListener) {
            globalThis.addEventListener = function(type, listener, options) {
              mainWindow.addEventListener(type, listener, options);
              Zotero.debug("[LibrarySearch] Event listener registered via globalThis proxy");
            };
            Zotero.debug("[LibrarySearch] globalThis.addEventListener function added");
          }
        } else {
          Zotero.debug("[LibrarySearch] Could not get main window, some fixes might not work");
        }
      } catch (e) {
        Zotero.debug("[LibrarySearch] Failed to fix window2: " + e);
      }

      // Set up a global error handler to catch remaining issues
      try {
        const mainWindow = Zotero.getMainWindow();
        if (mainWindow && mainWindow.addEventListener) {
          mainWindow.addEventListener('error', function(event) {
            // Get error details
            const message = event.message || 'Unknown error';
            const filename = event.filename || 'unknown';
            const line = event.lineno || 0;
            
            Zotero.debug("[LibrarySearch] Caught error: " + message + " at " + filename + ":" + line);
            
            // Suppress specific errors we know about
            if (message && (
                message.includes("_console.trace is not a function") ||
                message.includes("window2 is undefined") ||
                message.includes("globalThis.addEventListener")
            )) {
              Zotero.debug("[LibrarySearch] Suppressed known error: " + message);
              event.preventDefault();
              return true;
            }
            
            // Let other errors propagate
            return false;
          }, true);
          Zotero.debug("[LibrarySearch] Global error handler registered");
        }
      } catch (e) {
        Zotero.debug("[LibrarySearch] Failed to set up error handler: " + e);
      }
      
      BOOTSTRAP_FIXES.installed = true;
      Zotero.debug("[LibrarySearch] Bootstrap fixes loaded successfully");
    }
  } catch (e) {
    // Last resort - log to browser console if Zotero logging isn't available
    Components.utils.reportError("[LibrarySearch] Error in bootstrap fixes: " + e);
  }
}

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  // String 'rootURI' introduced in Zotero 7
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  // Apply runtime fixes before anything else
  applyRuntimeFixes(rootURI);

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

  // Add runtime fixes to context
  ctx.BOOTSTRAP_FIXES = BOOTSTRAP_FIXES;

  try {
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
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error during startup: " + e);
    Components.utils.reportError("[LibrarySearch] Error during startup: " + e);
  }
}

async function onMainWindowLoad({ window }, reason) {
  try {
    if (Zotero.LibrarySearch && typeof Zotero.LibrarySearch.hooks?.onMainWindowLoad === 'function') {
      Zotero.LibrarySearch.hooks.onMainWindowLoad(window);
    }
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error in onMainWindowLoad: " + e);
  }
}

async function onMainWindowUnload({ window }, reason) {
  try {
    if (Zotero.LibrarySearch && typeof Zotero.LibrarySearch.hooks?.onMainWindowUnload === 'function') {
      Zotero.LibrarySearch.hooks.onMainWindowUnload(window);
    }
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error in onMainWindowUnload: " + e);
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
  
  try {
    // Clean up the error handlers and window2 references
    try {
      const mainWindow = Zotero.getMainWindow();
      if (mainWindow) {
        // Remove event listeners if they exist
        if (BOOTSTRAP_FIXES.installed) {
          Zotero.debug("[LibrarySearch] Cleaning up bootstrap fixes");
          
          // Remove our properties from window if they exist
          if (Object.prototype.hasOwnProperty.call(mainWindow, 'window2')) {
            try {
              delete mainWindow.window2;
            } catch (e) {
              Zotero.debug("[LibrarySearch] Failed to clean up window2: " + e);
            }
          }
        }
      }
    } catch (e) {
      Zotero.debug("[LibrarySearch] Error cleaning up bootstrap fixes: " + e);
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
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error during shutdown: " + e);
    Components.utils.reportError("[LibrarySearch] Error during shutdown: " + e);
  }
}

function uninstall(data, reason) {}