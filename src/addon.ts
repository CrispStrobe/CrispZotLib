import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { BiblioRecord } from "./modules/librarySearch/models";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
      fallbackMap?: Record<string, string | ((name?: string, version?: string, time?: string) => string)>;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    dialog?: DialogHelper;
    lastSearchResults?: BiblioRecord[];
    
    // Fields for theme support
    mainThemeObserver?: MutationObserver;
    themeObserver?: MutationObserver;
  };

  // Lifecycle hooks
  public hooks: typeof hooks;

  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: createZToolkit(),
      lastSearchResults: []
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;