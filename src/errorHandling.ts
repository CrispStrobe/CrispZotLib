// src/errorHandling.ts

// Undo actions for everything installed below, run by teardownErrorHandling()
// from onShutdown. Without this, every disable/enable cycle stacked another
// capture listener and window2 getter on the main window that pointed into
// the unloaded plugin sandbox ("dead object" errors).
const cleanups: Array<() => void> = [];

/**
 * Safely patches window2 references and sets up error handling
 * This should be imported early in the bootstrap process
 */
export function setupErrorHandling() {
  try {
    patchWindow2Access();
    setupErrorListeners();
    Zotero.debug("[LibrarySearch] Error handling system initialized");
  } catch (e) {
    try {
      Zotero.debug("[LibrarySearch] Failed to setup error handling: " + e);
    } catch (_) {
      // Nothing more we can do
    }
  }
}

/** Remove the listener and window2 patch installed by setupErrorHandling. */
export function teardownErrorHandling() {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch (_) {
      // The window may already be gone; nothing to undo.
    }
  }
}

/**
 * Define `window2` on the main window for toolkit code that expects it.
 * (zotero-plugin-toolkit <6 registered a debug bridge that read it; the old
 * BasicTool.getZotero monkey-patch for that bridge is no longer needed.)
 */
function patchWindow2Access() {
  try {
    const mainWindow = getZoteroWindow() as any;
    if (
      mainWindow &&
      !Object.prototype.hasOwnProperty.call(mainWindow, "window2")
    ) {
      Object.defineProperty(mainWindow, "window2", {
        get: () => mainWindow,
        configurable: true,
      });
      cleanups.push(() => {
        delete mainWindow.window2;
      });
    }
  } catch (e) {
    Zotero.debug("[LibrarySearch] Error patching window2: " + e);
  }
}

// Known-noisy messages from old toolkit/console shims that we swallow.
const SUPPRESSED_ERRORS = [
  "_console.trace is not a function",
  "window2 is undefined",
  "Attempt to override an existing message",
];

/**
 * Sets up error listeners in the appropriate context
 */
function setupErrorListeners() {
  try {
    const targetWindow = getTargetWindow();
    if (!targetWindow) {
      Zotero.debug(
        "[LibrarySearch] Skip registering error handler - no suitable target window",
      );
      return;
    }
    const onError = (event: ErrorEvent) => {
      try {
        const message = event.message || "Unknown error";
        Zotero.debug(
          `[UNCAUGHT ERROR] ${message} at ${event.filename || "unknown"}:${event.lineno || 0}`,
        );
        if (SUPPRESSED_ERRORS.some((m) => message.includes(m))) {
          event.preventDefault();
        }
      } catch (_) {
        // If even our error handler fails, just let the default handler run
      }
    };
    targetWindow.addEventListener("error", onError, true);
    cleanups.push(() =>
      targetWindow.removeEventListener("error", onError, true),
    );
    Zotero.debug("[LibrarySearch] Successfully registered error handler");
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
