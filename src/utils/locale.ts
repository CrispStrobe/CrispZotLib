import { config } from "../../package.json";

export { initLocale, getString, getLocaleID };

/**
 * Initialize locale data
 */
function initLocale() {
  try {
    // Ensure we're using the correct ID format without double prefixes
    const localePath = `${config.addonRef}-addon.ftl`;
    
    const l10n = new (
      typeof Localization === "undefined"
        ? ztoolkit.getGlobal("Localization")
        : Localization
    )([localePath], true);
    
    addon.data.locale = {
      current: l10n,
    };
    ztoolkit.log("Locale initialized:", localePath);
  } catch (e) {
    ztoolkit.log('Error initializing locale:', e);
    // Create a dummy locale object as fallback
    addon.data.locale = {
      current: {
        formatMessagesSync: () => [{ value: "", attributes: {} }]
      }
    };
  }
}

/**
 * Get locale string
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
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

function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  try {
    // Add the addon reference prefix to the locale string if it doesn't already have it
    const localStringWithPrefix = localeString.startsWith(`${config.addonRef}-`) 
      ? localeString 
      : `${config.addonRef}-${localeString}`;
    
    const { branch, args } = options;
    
    // Make sure locale is initialized
    if (!addon.data.locale?.current) {
      ztoolkit.log("Locale not initialized, returning raw string");
      return localStringWithPrefix;
    }
    
    const pattern = addon.data.locale.current.formatMessagesSync([
      { id: localStringWithPrefix, args },
    ])[0];
    
    if (!pattern) {
      ztoolkit.log(`String not found: ${localStringWithPrefix}`);
      return localeString; // Return without prefix to be more readable
    }
    
    if (branch && pattern.attributes) {
      for (const attr of pattern.attributes) {
        if (attr.name === branch) {
          return attr.value;
        }
      }
      return pattern.attributes[branch] || localeString;
    } else {
      return pattern.value || localeString;
    }
  } catch (e) {
    // Fallback to a readable string if anything fails
    ztoolkit.log('Error getting locale string:', e);
    return localeString.replace(/^librarysearch-/, '').replace(/-/g, ' ');
  }
}

function getLocaleID(id: string) {
  return `${config.addonRef}-${id}`;
}