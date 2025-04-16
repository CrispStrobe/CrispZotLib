// index.ts
import { ensureEnvironment } from './polyfills';

// Apply polyfills early to ensure environment is ready
try {
  ensureEnvironment();
} catch (e) {
  if (typeof Zotero !== 'undefined') {
    Zotero.debug("Error applying polyfills: " + e);
  } else if (typeof console !== 'undefined') {
    console.error("Error applying polyfills:", e);
  }
}

// Rest of your code...
import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";
import { setupErrorHandling } from "./errorHandling";

// Immediately set up error handling
try {
  setupErrorHandling();
} catch (e) {
  // Last resort error handling
  if (typeof Zotero !== 'undefined' && Zotero.debug) {
    Zotero.debug(`Error setting up error handling: ${e}`);
  }
}

// Create a global basicTool instance
const basicTool = new BasicTool();

try {
  // Create our addon object first so it's available to bootstrap.js
  _globalThis.addon = new Addon();
  
  // Set up ztoolkit global
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  
  // Make sure to expose necessary APIs
  if (typeof (Zotero as any)[config.addonInstance] !== 'object') {
    // Initialize the LibrarySearch property on Zotero
    (Zotero as any)[config.addonInstance] = {
      openSearch: () => {
        if (_globalThis.addon && _globalThis.addon.hooks) {
          _globalThis.addon.hooks.onDialogEvents("openSearch");
        }
      }
    };
    
    // Make the object's properties accessible
    Object.defineProperty((Zotero as any)[config.addonInstance], "data", {
      get: () => _globalThis.addon.data
    });
    
    Object.defineProperty((Zotero as any)[config.addonInstance], "hooks", {
      get: () => _globalThis.addon.hooks
    });
  }
  
  Zotero.debug(`${config.addonName} has been loaded`);

} catch (e) {
  // Log the error even if our initialization fails
  if (typeof Zotero !== 'undefined' && Zotero.debug) {
    Zotero.debug(`Error loading ${config.addonName || 'plugin'}: ${e}`);
  } else if (typeof console !== 'undefined') {
    console.error(`Error loading plugin: `, e);
  }
}

function defineGlobal(name: string): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}