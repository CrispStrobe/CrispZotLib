// src/errorHandling.ts

/**
 * Safely patches window2 references and sets up error handling
 * This should be imported early in the bootstrap process
 */
export function setupErrorHandling() {
  try {
    // Patch window2 access
    patchWindow2Access();

    // Setup appropriate error handlers based on environment
    setupErrorListeners();

    Zotero.debug("[LibrarySearch] Error handling system initialized");
  } catch (e) {
    // Last-resort error logging
    try {
      Zotero.debug("[LibrarySearch] Failed to setup error handling: " + e);
    } catch (_) {
      // Nothing more we can do
    }
  }
}

/**
 * Patches access to window2 which is used by some debugging tools
 */
function patchWindow2Access() {
  try {
    // Get the main Zotero window
    const mainWindow = getZoteroWindow();

    if (mainWindow) {
      // Define a window2 property that just returns the main window
      const mainWindowAny = mainWindow as any;

      if (!Object.prototype.hasOwnProperty.call(mainWindowAny, "window2")) {
        Object.defineProperty(mainWindowAny, "window2", {
          get: function () {
            return mainWindow;
          },
          configurable: true,
        });
      }

      // Also patch BasicTool.getZotero if it exists
      if (mainWindowAny.BasicTool && mainWindowAny.BasicTool.getZotero) {
        const originalGetZotero = mainWindowAny.BasicTool.getZotero;
        mainWindowAny.BasicTool.getZotero = function () {
          const _Zotero = originalGetZotero();
          if (_Zotero) {
            // Add _toolkitGlobal if it doesn't exist
            const zoteroAny = _Zotero as any;
            if (!zoteroAny._toolkitGlobal) {
              zoteroAny._toolkitGlobal = {
                debugBridge: {
                  version: 0,
                  disableDebugBridgePassword: true,
                  password: "",
                  initializeDebugBridge: function () {},
                },
                pluginBridge: {
                  version: 0,
                  initializePluginBridge: function () {},
                },
                currentWindow: mainWindow,
              };
            }
          }
          return _Zotero;
        };
      }
    }
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error patching window2: " + e);
  }
}

/**
 * Sets up error listeners in the appropriate context
 */
function setupErrorListeners() {
  try {
    // Get the appropriate window to attach the listener to
    const targetWindow = getTargetWindow();

    if (targetWindow) {
      // Add the error listener to the appropriate window
      (targetWindow as any).addEventListener(
        "error",
        function (event: any) {
          try {
            if (typeof Zotero !== "undefined" && Zotero.debug) {
              const message = event.message || "Unknown error";
              const filename = event.filename || "unknown";
              const lineno = event.lineno || 0;

              Zotero.debug(
                "[UNCAUGHT ERROR] " +
                  message +
                  " at " +
                  filename +
                  ":" +
                  lineno,
              );

              // Prevent the error from showing in the console if it's related to our known issues
              if (
                message &&
                (message.includes("_console.trace is not a function") ||
                  message.includes("window2 is undefined") ||
                  message.includes("Attempt to override an existing message"))
              ) {
                event.preventDefault();
                return true;
              }
            }
          } catch (e) {
            // If even our error handler fails, just let the default handler run
          }
          return false;
        },
        true,
      );

      Zotero.debug("[LibrarySearch] Successfully registered error handler");
    } else {
      Zotero.debug(
        "[LibrarySearch] Skip registering error handler - no suitable target window",
      );
    }
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error setting up error listeners: " + e);
  }
}

/**
 * Gets the Zotero main window
 */
function getZoteroWindow(): Window | null {
  try {
    if (typeof Zotero !== "undefined") {
      // Try Zotero.getMainWindow first
      if (Zotero.getMainWindow) {
        return Zotero.getMainWindow();
      }

      // Fallback to other methods
      if (Zotero.getZoteroPanes) {
        const zoteroPanes = Zotero.getZoteroPanes();
        if (
          zoteroPanes &&
          zoteroPanes.length > 0 &&
          (zoteroPanes[0] as any).window
        ) {
          return (zoteroPanes[0] as any).window;
        }
      }
    }

    return null;
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error getting Zotero window: " + e);
    return null;
  }
}

/**
 * Gets the appropriate window to attach error listeners to
 */
function getTargetWindow(): Window | null {
  try {
    // Try different methods to get a valid window reference

    // 1. Zotero main window
    if (typeof Zotero !== "undefined" && Zotero.getMainWindow) {
      const mainWindow = Zotero.getMainWindow();
      if (mainWindow) {
        return mainWindow;
      }
    }

    // 2. ZoteroPane's window from ZoteroPanes
    if (typeof Zotero !== "undefined" && Zotero.getZoteroPanes) {
      const zoteroPanes = Zotero.getZoteroPanes();
      if (
        zoteroPanes &&
        zoteroPanes.length > 0 &&
        (zoteroPanes[0] as any).window
      ) {
        return (zoteroPanes[0] as any).window;
      }
    }

    // No suitable window found
    return null;
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error getting target window: " + e);
    return null;
  }
}
