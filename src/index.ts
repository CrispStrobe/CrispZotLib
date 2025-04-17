// src/index.ts
import { ensureEnvironment } from './polyfills';
import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";
import { setupErrorHandling } from "./errorHandling";

// 1. Apply generic environment polyfills first
try {
  ensureEnvironment();
} catch (e) {
  if (typeof Zotero !== 'undefined') {
    Zotero.debug("Error applying polyfills: " + e);
  } else if (typeof console !== 'undefined') {
    console.error("Error applying polyfills:", e);
  }
}

// 2. Apply your runtime error‐handler hooks
try {
  setupErrorHandling();
} catch (e) {
  if (typeof Zotero !== 'undefined' && Zotero.debug) {
    Zotero.debug(`Error setting up error handling: ${e}`);
  }
}

// 3. Create the toolkit and our addon
const basicTool = new BasicTool();
_globalThis.addon = new Addon();

// 4. Patch `window2` on the sandbox global so code that does `window2` won't blow up
_globalThis.window2 = Zotero.getMainWindow();

// 5. Expose the toolkit under a sane name
defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);

// 6. If nobody’s already put your API on `Zotero.LibrarySearch`, do so now
if (!(Zotero as any)[config.addonInstance]) {
  (Zotero as any)[config.addonInstance] = {
    openSearch: () => _globalThis.addon.hooks.onDialogEvents("openSearch"),
  };
  Object.defineProperty((Zotero as any)[config.addonInstance], "data", {
    get: () => _globalThis.addon.data
  });
  Object.defineProperty((Zotero as any)[config.addonInstance], "hooks", {
    get: () => _globalThis.addon.hooks
  });
}

Zotero.debug(`${config.addonName} has been loaded`);


/**
 * Utility to expose globals from the toolkit into your sandbox.
 */
function defineGlobal(name: string, getter: () => any) {
  Object.defineProperty(_globalThis, name, {
    get: getter,
  });
}
