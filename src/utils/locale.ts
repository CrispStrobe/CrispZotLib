/**
 * locale.ts - Handles localization for the Library Search plugin
 */

import { config } from "../../package.json";

export { initLocale, getString, getLocaleID };

// Type for addon.data.locale
interface LocaleData {
  current: {
    formatMessagesSync: (
      messages: Array<{ id: string; args?: Record<string, unknown> }>,
    ) => Array<{
      value: string;
      attributes?:
        Array<{ name: string; value: string }> | Record<string, string>;
    }>;
  };
  fallbackMap: Record<
    string,
    string | ((name?: string, version?: string, time?: string) => string)
  >;
}

/**
 * Initialize locale data and load all FTL files
 */
function initLocale() {
  try {
    // Define all FTL files to load
    const localePaths = [
      `${config.addonRef}-addon.ftl`,
      `${config.addonRef}-preferences.ftl`,
      `${config.addonRef}-mainWindow.ftl`,
    ];

    // Get localization service
    // Note the explicit any type to avoid the reference error
    let localizer: any;
    if (typeof Localization === "undefined") {
      localizer = ztoolkit.getGlobal("Localization");
    } else {
      localizer = Localization;
    }

    // Initialize l10n with all paths
    const l10n = new localizer(localePaths, true);

    // Create the locale object with proper typing
    const localeData: LocaleData = {
      current: l10n,
      fallbackMap: createFallbacks(),
    };

    // Store in addon data
    addon.data.locale = localeData;

    // Add fallbacks separately to avoid type errors
    // localeData.fallbackMap = createFallbacks();

    ztoolkit.log("Locale initialized with paths:", localePaths.join(", "));
  } catch (e) {
    ztoolkit.log("Error initializing locale:", e);

    // Create a dummy locale object with fallbacks for critical UI elements
    const dummyLocale: LocaleData = {
      current: {
        formatMessagesSync: () => [{ value: "", attributes: [] }],
      },
      fallbackMap: createFallbacks(),
    };

    addon.data.locale = dummyLocale;
  }
}

/**
 * Create fallback values for critical UI strings
 * This ensures the UI is usable even if locale files fail to load
 */
function createFallbacks(): Record<
  string,
  string | ((name?: string, version?: string, time?: string) => string)
> {
  return {
    // Preferences strings
    "prefs-title": "Library Search",
    "prefs-enable": "Enable Library Search",
    "prefs-python-path": "Python Executable Path",
    "prefs-script-path": "Search Script Path",
    "prefs-browse": "Browse...",
    "prefs-table-setting": "Setting",
    "prefs-table-value": "Value",
    "prefs-help": (name?: string, version?: string, time?: string) =>
      `${name || "Library Search"} ${version || ""}, built ${time || ""}`,

    // Main window strings
    "startup-begin": "Library Search: Starting plugin...",
    "startup-finish": "Library Search: Plugin ready",
    "toolbar-button-label": "Search Libraries",
    "toolbar-button-tooltip": "Search library catalogs and repositories",
    "menu-item-label": "Library Search",

    // Dialog strings
    "search-dialog-title": "Library Search",
    "search-dialog-description":
      "Search libraries and repositories for items to import into Zotero.",
    "search-dialog-config-section": "Configuration",
    "search-dialog-python-path": "Python Path:",
    "search-dialog-script-path": "Script Path:",
    "search-dialog-search-section": "Search Parameters",
    "search-dialog-protocol": "Protocol:",
    "search-dialog-endpoint": "Endpoint:",
    "search-dialog-title-field": "Title:",
    "search-dialog-author": "Author:",
    "search-dialog-isbn": "ISBN/ISSN:",
    "search-dialog-max-results": "Max Results:",
    "search-dialog-search-button": "Search",
    "search-dialog-cancel-button": "Cancel",
    "search-dialog-searching": "Searching...",
    "search-dialog-no-results": "No results found",
    "search-dialog-error": "An error occurred during search",

    // Results dialog strings
    "results-dialog-title": "Search Results",
    "results-dialog-import-selected": "Import Selected",
    "results-dialog-import-all": "Import All",
    "results-dialog-cancel": "Cancel",
    "results-dialog-no-selection": "Please select at least one item to import",
    "results-dialog-import-success": "Items successfully imported",
    "results-dialog-import-error": "Error importing items",

    // Error messages
    "search-error-missing-paths": "Python path and script path must be set",
    "search-error-missing-endpoint": "Endpoint must be specified",
    "search-error-missing-search-terms":
      "At least one search term must be provided",
    "search-error-script-failed": "Search script execution failed",
    "search-error-invalid-results":
      "Invalid results returned from search script",
  };
}

/**
 * Get localized string with various parameter options
 */
function getString(localeString: string): string;
function getString(localeString: string, branch: string): string;
function getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    return _getString(inputs[0]);
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] });
    } else {
      return _getString(inputs[0], inputs[1]);
    }
  } else {
    throw new Error("Invalid arguments");
  }
}

/**
 * Internal implementation of getString with robust error handling
 */
function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  try {
    // Ensure addon is initialized
    if (!addon?.data?.locale?.current) {
      return getFallbackString(localeString, options);
    }

    // Add prefix if needed
    const localStringWithPrefix = ensurePrefix(localeString);

    const { branch, args } = options;

    // Try to get localized string
    let pattern;
    try {
      pattern = addon.data.locale.current.formatMessagesSync([
        { id: localStringWithPrefix, args },
      ])[0];
    } catch (e) {
      ztoolkit.log(
        `Error formatting locale string ${localStringWithPrefix}:`,
        e,
      );
      return getFallbackString(localeString, options);
    }

    // Handle null/undefined pattern
    if (!pattern || !pattern.value) {
      return getFallbackString(localeString, options);
    }

    // Handle branch attribute if needed
    if (branch && pattern.attributes) {
      // Try to find the attribute directly
      if (Array.isArray(pattern.attributes)) {
        for (const attr of pattern.attributes) {
          if (attr.name === branch) {
            return attr.value;
          }
        }
      }

      // Try to access as object property
      const attrObj = pattern.attributes as Record<string, string>;
      if (attrObj[branch]) {
        return attrObj[branch];
      }

      // Fall back to main value if no attribute found
      return pattern.value;
    }

    // Return the main value
    return pattern.value;
  } catch (e) {
    ztoolkit.log(`Critical error in getString for ${localeString}:`, e);
    return getFallbackString(localeString, options);
  }
}

/**
 * Get fallback string when locale lookup fails
 */
function getFallbackString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  try {
    // Try to get from fallbacks using fallbackMap
    const fallbackMap = addon?.data?.locale?.fallbackMap;

    if (fallbackMap && fallbackMap[localeString]) {
      const fallback = fallbackMap[localeString];
      if (typeof fallback === "function") {
        // Handle function fallbacks with args
        const { args } = options;
        if (args) {
          return fallback(
            args.name as string,
            args.version as string,
            args.time as string,
          );
        }
        return fallback();
      }
      return fallback;
    }

    // Last resort: convert ID to readable text
    return prettifyString(localeString);
  } catch (e) {
    // Absolute last resort
    return prettifyString(localeString);
  }
}

/**
 * Ensure string has the addon reference prefix
 */
function ensurePrefix(str: string): string {
  return str.startsWith(`${config.addonRef}-`)
    ? str
    : `${config.addonRef}-${str}`;
}

/**
 * Convert a string ID to a readable format
 */
function prettifyString(str: string): string {
  return str
    .replace(new RegExp(`^${config.addonRef}-`), "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get locale ID with addon prefix
 */
function getLocaleID(id: string): string {
  return ensurePrefix(id);
}
