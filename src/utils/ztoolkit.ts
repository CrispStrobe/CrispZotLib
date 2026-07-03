/**
 * ztoolkit.ts - Toolkit utilities for Zotero plugins
 * Provides safe console handling and toolkit initialization
 */

// Define console polyfill before any other code
if (typeof globalThis !== "undefined" && !globalThis.console) {
  // Define console if it doesn't exist
  (globalThis as any).console = {
    log: function (...args: any[]) {
      try {
        Zotero.debug("[LOG] " + args.map((a) => String(a)).join(" "));
      } catch (e) {
        // If even this fails, we can't do anything more
      }
    },
    warn: function (...args: any[]) {
      try {
        Zotero.debug("[WARN] " + args.map((a) => String(a)).join(" "));
      } catch (e) {
        // Cannot do anything more
      }
    },
    error: function (...args: any[]) {
      try {
        Zotero.debug("[ERROR] " + args.map((a) => String(a)).join(" "));
      } catch (e) {
        // Cannot do anything more
      }
    },
    group: function (...args: any[]) {
      try {
        Zotero.debug("[GROUP] " + args.map((a) => String(a)).join(" "));
      } catch (e) {
        // Cannot do anything more
      }
    },
    groupEnd: function () {
      try {
        Zotero.debug("[GROUP END]");
      } catch (e) {
        // Cannot do anything more
      }
    },
  };
}

import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit, safeConsole };

/**
 * Safe logging function that works in all environments
 * @param level Log level ('log', 'warn', 'error')
 * @param args Arguments to log
 */
function safeLog(level: "log" | "warn" | "error", ...args: any[]): void {
  try {
    // Try to stringify objects for better logging
    const processed = args.map((arg) => {
      if (arg === undefined) return "undefined";
      if (arg === null) return "null";

      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }

      return String(arg);
    });

    // First try regular console
    if (typeof console !== "undefined" && console[level]) {
      console[level](...args);
    }

    // Always log to Zotero.debug as a backup
    try {
      if (typeof Zotero !== "undefined" && Zotero.debug) {
        Zotero.debug(`[${level.toUpperCase()}] ${processed.join(" ")}`);
      }
    } catch (e) {
      // Nothing we can do if even Zotero.debug fails
    }
  } catch (e) {
    // Last resort attempt
    try {
      Zotero.debug(`Failed to log: ${e}`);
    } catch (e2) {
      // Nothing we can do at this point
    }
  }
}

/**
 * Safe console implementation that works in all environments
 */

/**
 * Safe console implementation that works in all environments
 */
const safeConsole = {
  log: (...args: any[]) => safeLog("log", ...args),
  warn: (...args: any[]) => safeLog("warn", ...args),
  error: (...args: any[]) => safeLog("error", ...args),
  // Add trace method that properly handles undefined console.trace
  trace: (...args: any[]) => {
    try {
      if (
        typeof console !== "undefined" &&
        typeof console.trace === "function"
      ) {
        console.trace(...args);
      } else {
        // Fallback to regular logging with stack trace info
        safeLog("log", "[TRACE]", ...args);

        // Attempt to create a stack trace manually
        try {
          const err = new Error();
          if (err.stack) {
            safeLog("log", err.stack.split("\n").slice(1).join("\n"));
          }
        } catch (e) {
          // If even this fails, just continue
        }
      }
    } catch (e) {
      // Fallback to regular logging if tracing fails
      safeLog("log", "[TRACE Fallback]", ...args);
    }
  },
  // Keep your existing group methods
  group: (...args: any[]) => {
    try {
      if (typeof console !== "undefined" && console.group) {
        console.group(...args);
      } else {
        safeLog("log", `GROUP START: ${args.join(" ")}`);
      }
    } catch (e) {
      // Fallback to regular log
      safeLog("log", ...args);
    }
  },
  groupEnd: () => {
    try {
      if (typeof console !== "undefined" && console.groupEnd) {
        console.groupEnd();
      } else {
        safeLog("log", "GROUP END");
      }
    } catch (e) {
      // Nothing to do on error
    }
  },
};

/**
 * Creates and initializes the Zotero toolkit
 * @returns Initialized ZoteroToolkit instance
 */
function createZToolkit() {
  const _ztoolkit = new ZoteroToolkit();

  // Patch the toolkit to prevent window2 errors
  try {
    // Disable all debug bridge functionality
    if (_ztoolkit.getGlobal && typeof _ztoolkit.getGlobal === "function") {
      const origGetGlobal = _ztoolkit.getGlobal.bind(_ztoolkit);

      // Add proper type annotation for the k parameter
      _ztoolkit.getGlobal = function (k: string): any {
        try {
          // Special case for window2 which is used by debug bridge
          if (k === "window2") {
            return _ztoolkit.getGlobal("window");
          }
          return origGetGlobal(k);
        } catch (e) {
          console.error("Error in getGlobal:", e);
          if (k === "window" || k === "document") {
            return Zotero.getMainWindow();
          }
          return undefined;
        }
      };
    }
  } catch (e) {
    console.error("Failed to patch ztoolkit:", e);
  }

  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

/**
 * Initialize toolkit with options and override logging
 * @param _ztoolkit The toolkit to initialize
 */
function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;

  // Set basic options
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";

  // Override logging to use safeConsole
  _ztoolkit.log = function (message: any, ...optionalParams: any[]) {
    safeConsole.log(message, ...optionalParams);
  };

  // UI options
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = __env__ === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = __env__ === "development";

  // Plugin ID
  _ztoolkit.basicOptions.api.pluginID = config.addonID;

  // Set progress window icon
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}

/**
 * Utility functions for the toolkit extension
 * These can be used throughout the addon
 */
export function getValidWindow(): Window | null {
  // Try dialog window first
  if (addon.data.dialog?.window) {
    return addon.data.dialog.window;
  }

  // Then main Zotero window
  try {
    return Zotero.getMainWindow();
  } catch (e) {
    safeConsole.error("Error getting main window:", e);
  }

  // Last resort - try any Zotero window
  const windows = Zotero.getMainWindows();
  if (windows && windows.length > 0) {
    return windows[0];
  }

  return null;
}
