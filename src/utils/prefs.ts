// src/utils/prefs.ts

import { config } from "../../package.json";

// Define possible preference value types we expect to store/retrieve
type PrefValue = string | number | boolean;

const PREFS_PREFIX = config.prefsPrefix; // Get prefix like "extensions.zotero.librarysearch"
const LOG_PREFIX = `[${PREFS_PREFIX}]`; // Define log prefix for consistency

/**
 * Get preference value. Allows any string key.
 * Wrapper of `Zotero.Prefs.get`.
 * @param key The preference key (without the extension prefix).
 * @returns The preference value, or undefined if not set or an error occurs.
 */
export function getPref(key: string): PrefValue | undefined {
  try {
    const fullKey = `${PREFS_PREFIX}.${key}`;
    const value = Zotero.Prefs.get(fullKey, true);

    if (value === undefined || value === null) {
      // Use Zotero.debug for informational messages
      // _globalThis.Zotero?.debug?.(`${LOG_PREFIX} Pref '${key}' not found or null.`); // Optional: Only log if debugging needed
      return undefined;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    } else {
      // Use console.warn for unexpected situations
      console.warn(
        `${LOG_PREFIX} Warning: Pref '${key}' has unexpected type: ${typeof value}`,
      );
      return undefined; // Return undefined for safety
    }
  } catch (e) {
    // Use console.error for actual errors
    console.error(
      `${LOG_PREFIX} Error getting pref '${key}': ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}

/**
 * Set preference value. Allows any string key.
 * Wrapper of `Zotero.Prefs.set`.
 * @param key The preference key (without the extension prefix).
 * @param value The value to set (string, number, or boolean).
 */
export function setPref(key: string, value: PrefValue): void {
  try {
    const fullKey = `${PREFS_PREFIX}.${key}`;
    Zotero.Prefs.set(fullKey, value, true);
    // Use Zotero.debug for successful operations (often useful during development)
    // _globalThis.Zotero?.debug?.(`${LOG_PREFIX} Set pref '${key}' to: ${value}`); // Optional: Uncomment if needed
  } catch (e) {
    console.error(
      `${LOG_PREFIX} Error setting pref '${key}' to '${value}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Clear preference value.
 * Wrapper of `Zotero.Prefs.clear`.
 * @param key The preference key (without the extension prefix).
 */
export function clearPref(key: string): void {
  try {
    const fullKey = `${PREFS_PREFIX}.${key}`;
    Zotero.Prefs.clear(fullKey, true);
    // Use Zotero.debug for successful operations
    // _globalThis.Zotero?.debug?.(`${LOG_PREFIX} Cleared pref '${key}'.`); // Optional: Uncomment if needed
  } catch (e) {
    console.error(
      `${LOG_PREFIX} Error clearing pref '${key}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
