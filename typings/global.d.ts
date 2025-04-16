declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

// Add namespace for Components
declare namespace Components {
  const classes: any;
  const interfaces: any;
  const utils: {
    isDeadWrapper(obj: any): boolean;
  };
}

// Add interface extension for XUL Tree
declare namespace XUL {
  interface Tree {
    invalidate?: () => void;
    // We intentionally don't include builder to prevent TypeScript errors
    // Use 'as any' to access builder in code instead
  }
}

// Add interface extension for Zotero namespace and types
declare namespace _ZoteroTypes {
  interface Zotero {
    Promise: {
      defer(): { promise: Promise<any>; resolve: (value?: any) => void; reject: (reason?: any) => void };
      // other Promise methods
    };
    CreatorTypes: {
      getID(type: string): number;
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
    getMainWindow(): Window;
  }
  
  interface Item {
    setCreator(position: number, creatorDataID: any, creatorTypeID: any): void;
    addTag(tag: string): void;
  }
}