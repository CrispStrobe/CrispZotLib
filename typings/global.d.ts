// typings/global.d.ts

// Declare _globalThis as it's used in the template
declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
  addEventListener?: typeof window.addEventListener;
  removeEventListener?: typeof window.removeEventListener;
  dispatchEvent?: typeof window.dispatchEvent;
  _console?: Console;
};

// Standard declarations
declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

// Add namespace for Components
declare namespace Components {
  const classes: {
    [key: string]: {
      createInstance(interface: any): any;
      getService(interface: any): any;
    };
  };
  const interfaces: {
    nsIProcess: any;
    nsIFile: any;
    nsIPipe: any;
    nsIScriptableInputStream: any;
    nsIFilePicker: any;
    nsIXULRuntime: any;
    nsIEnvironment: any;
    nsIProperties: any;  
    nsIWindowMediator: any;
  };
  const utils: {
    isDeadWrapper(obj: any): boolean;
  };
}

// Extend Window interface
interface Window {
  matchMedia(query: string): MediaQueryList | null;
  window2?: Window;
  Zotero?: any;
  ZoteroPane?: any;
}

// Global declarations
declare global {
  // Standard globalThis extensions
  var globalThis: {
    addEventListener: typeof window.addEventListener;
    removeEventListener: typeof window.removeEventListener;
    dispatchEvent: typeof window.dispatchEvent;
    _console?: Console;
    [key: string]: any;
  }
}

interface MediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => any) | null;
  addListener(callback: (this: MediaQueryList, ev: MediaQueryListEvent) => any): void;
  removeListener(callback: (this: MediaQueryList, ev: MediaQueryListEvent) => any): void;
}

interface MediaQueryListEvent {
  matches: boolean;
  media: string;
}

// Add interface extension for XUL Tree
declare namespace XUL {
  interface Tree {
    invalidate?: () => void;
    // We intentionally don't include builder to prevent TypeScript errors
    // builder property can be accessed using (tree as any).builder
  }
}

// Add interface extension for Zotero namespace and types
declare namespace _ZoteroTypes {
  // Define the full Zotero interface instead of just extending it
  interface Zotero {
    Item: new (itemType: string) => Item;
    initializationPromise: Promise<void>;
    unlockPromise: Promise<void>;
    uiReadyPromise: Promise<void>;
    getMainWindows(): Window[];
    getMainWindow(): Window;
    getActiveZoteroPane(): ZoteroPane;
    PreferencePanes: {
      register(options: {
        pluginID: string;
        src: string;
        label: string;
        image: string;
      }): void;
    };
    Promise: {
      defer(): { promise: Promise<any>; resolve: (value?: any) => void; reject: (reason?: any) => void };
      delay(ms: number): Promise<void>;
    };
    Creators: {
      getDataID(data: any): number;
      save(data: any): number;
    };
    CreatorData: {
      new(): {
        firstName: string;
        lastName: string;
        fieldMode: number;
      };
    };
    CreatorTypes: {
      getID(type: string): number;
    };
    Prefs: {
      get(pref: string, global?: boolean): any;
      set(pref: string, value: any, global?: boolean): any;
      clear(pref: string, global?: boolean): void;
    };
    debug(message: any): void;
    logError(error: any): void;
    isWin: boolean;
    isMac: boolean;
    isLinux: boolean;
    LibrarySearch?: {
      openSearch: () => void;
      hooks?: {
        onStartup: () => Promise<void>;
        onShutdown: () => void;
        onMainWindowLoad: (win: Window) => Promise<void>;
        onMainWindowUnload: (win: Window) => Promise<void>;
        onPrefsEvent: (type: string, data: { [key: string]: any }) => Promise<void>;
        onDialogEvents: (type: string, data?: any) => Promise<any>;
      };
      data?: any;
    };
  }
  
  interface ZoteroPane {
    getSelectedCollection(): { id: number; libraryID: number } | null;
    getSelectedLibraryID(): number;
    selectItems(itemIDs: number[]): void;
  }
  
  interface Item {
    id?: number;
    itemType: string;
    setField(field: string, value: string): void;
    setCreator(position: number, creatorDataID: any, creatorTypeID: any): void;
    addTag(tag: string): void;
    setCollections(collectionIDs: number[]): void;
    saveTx(): Promise<void>;
  }
}