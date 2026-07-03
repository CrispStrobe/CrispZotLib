// Theme and Path Detection Utilities for Library Search Plugin

/**
 * Utility functions for theme detection and Python path discovery
 */
export class ThemeUtils {
  /**
   * Apply the theme to a window based on Zotero's current theme
   * @param window The window to apply the theme to
   */
  static applyTheme(window: Window): void {
    try {
      // Get the main Zotero window to check its theme
      const mainWindow = Zotero.getMainWindow();
      if (!mainWindow) return;

      // Determine if dark mode is active
      const isDarkMode = ThemeUtils.isZoteroDarkMode(mainWindow);

      // Set the theme attribute on the document - with null check
      const doc = window.document;
      if (doc && doc.documentElement) {
        doc.documentElement.setAttribute(
          "data-theme",
          isDarkMode ? "dark" : "light",
        );
        ztoolkit.log(
          `Applied ${isDarkMode ? "dark" : "light"} theme to window`,
        );
      }
    } catch (e) {
      ztoolkit.log("Error applying theme:", e);
    }
  }

  /**
   * Check if Zotero is running in dark mode
   * @param window The window to check (defaults to Zotero main window)
   * @returns boolean indicating if dark mode is active
   */
  static isZoteroDarkMode(window?: Window): boolean {
    try {
      // If no window is provided, get the main window
      const win = window || Zotero.getMainWindow();
      if (!win) return false;

      const doc = win.document;
      if (!doc || !doc.documentElement) return false;

      // Multiple ways to detect dark mode in Zotero

      // Method 1: Check for data-theme attribute (Zotero 7)
      if (doc.documentElement.getAttribute("data-theme") === "dark") {
        return true;
      }

      // Method 2: Check for dark mode class (Zotero 6)
      if (doc.documentElement.classList.contains("theme-dark")) {
        return true;
      }

      // Method 3: Check media query preference (fallback)
      // Use assertion to ensure matchMedia is not null
      try {
        const mql = win.matchMedia("(prefers-color-scheme: dark)");
        if (mql && mql.matches) {
          return true;
        }
      } catch (e) {
        // Ignore matchMedia errors - some environments might not support it
        ztoolkit.log("matchMedia error (ignoring):", e);
      }

      // Default to light mode if none of the above methods detect dark mode
      return false;
    } catch (e) {
      ztoolkit.log("Error detecting dark mode:", e);
      return false;
    }
  }

  /**
   * Set up a mutation observer to detect theme changes in Zotero
   * @param callback Function to call when theme changes
   * @returns The created observer (can be used to disconnect)
   */
  static observeThemeChanges(
    callback: (isDarkMode: boolean) => void,
  ): MutationObserver | undefined {
    try {
      const mainWindow = Zotero.getMainWindow();
      if (!mainWindow) return undefined;

      const doc = mainWindow.document;
      if (!doc || !doc.documentElement) return undefined;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.type === "attributes" &&
            (mutation.attributeName === "data-theme" ||
              mutation.attributeName === "class")
          ) {
            const isDarkMode = ThemeUtils.isZoteroDarkMode(mainWindow);
            callback(isDarkMode);
            break;
          }
        }
      });

      observer.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class"],
      });

      return observer;
    } catch (e) {
      ztoolkit.log("Error setting up theme observer:", e);
      return undefined;
    }
  }
}

/**
 * Utilities for detecting and suggesting Python paths
 */
export class PathUtils {
  /**
   * Get the user's home directory
   * @returns Path to user's home directory
   */
  static getUserHome(): string {
    try {
      // Try various environment variables
      // Use type assertion to match the Components.interfaces structure
      const env = Components.classes[
        "@mozilla.org/process/environment;1"
      ].getService(Components.interfaces.nsIEnvironment as any);

      let home = "";

      // Check common environment variables for home directory
      if (Zotero.isWin) {
        home =
          env.get("USERPROFILE") || env.get("HOMEDRIVE") + env.get("HOMEPATH");
      } else {
        home = env.get("HOME");
      }

      return home;
    } catch (e) {
      ztoolkit.log("Error getting user home directory:", e);

      // Fallback method - try using Zotero profile directory
      try {
        // Use type assertion for nsIProperties interface
        const profileDir = Components.classes[
          "@mozilla.org/file/directory_service;1"
        ]
          .getService(Components.interfaces.nsIProperties as any)
          .get("ProfD", Components.interfaces.nsIFile as any);

        // Go up from the profile directory to get closer to home
        // This isn't ideal but can work as a fallback
        if (profileDir && profileDir.parent && profileDir.parent.parent) {
          return profileDir.parent.parent.path;
        }
      } catch (e2) {
        ztoolkit.log("Fallback home directory detection failed:", e2);
      }

      return "";
    }
  }

  /**
   * Get the user's home folder name
   * @returns The username part of the home path
   */
  static getUserHomeFolder(): string {
    try {
      const home = this.getUserHome();
      if (!home) return "";

      // Extract username from path
      const parts = home.split(/[\\/]/);
      return parts[parts.length - 1] || "";
    } catch (e) {
      ztoolkit.log("Error getting username:", e);
      return "";
    }
  }

  /**
   * Check if a file exists
   * @param path Path to check
   * @returns Boolean indicating if file exists
   */
  static fileExists(path: string): boolean {
    try {
      // Create an nsIFile for the path
      const file = Components.classes[
        "@mozilla.org/file/local;1"
      ].createInstance(Components.interfaces.nsIFile as any);

      if (!file) return false;

      file.initWithPath(path);

      return file.exists() && file.isExecutable();
    } catch (e) {
      // File doesn't exist or path is invalid
      return false;
    }
  }
}
