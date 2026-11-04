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
