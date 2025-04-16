// bootstrap-fixes.js

/**
 * This file contains runtime fixes that are applied early in the addon lifecycle
 * before the main JavaScript bundle is even loaded
 */

(() => {
  if (typeof Zotero === 'undefined') {
    return; // Cannot proceed without Zotero
  }

  Zotero.debug("[LibrarySearch] Applying runtime fixes...");

  // 1. Fix for missing console.trace
  try {
    if (typeof console === 'undefined') {
      // Create console if it doesn't exist
      this.console = {
        log: function() { Zotero.debug(Array.from(arguments).join(' ')); },
        warn: function() { Zotero.debug('[WARN] ' + Array.from(arguments).join(' ')); },
        error: function() { Zotero.debug('[ERROR] ' + Array.from(arguments).join(' ')); },
        info: function() { Zotero.debug('[INFO] ' + Array.from(arguments).join(' ')); },
        trace: function() { Zotero.debug('[TRACE] ' + Array.from(arguments).join(' ')); }
      };
    } else if (typeof console.trace !== 'function') {
      // Add missing trace function
      console.trace = function() { 
        Zotero.debug('[TRACE] ' + Array.from(arguments).join(' ')); 
      };
    }
    Zotero.debug("[LibrarySearch] Console trace function fixed");
  } catch (e) {
    Zotero.debug("[LibrarySearch] Failed to fix console: " + e);
  }

  // 2. Fix for missing window2
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

  // 3. Set up a global error handler to catch remaining issues
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

  Zotero.debug("[LibrarySearch] Runtime fixes applied");
})();