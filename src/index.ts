import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

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

function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}