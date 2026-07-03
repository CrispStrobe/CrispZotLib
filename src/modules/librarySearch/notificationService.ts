// src/modules/librarySearch/notificationService.ts
import { config } from "../../../package.json"; // Adjust path as needed

/**
 * Notification Service to handle user messages about the plugin status
 */
export class NotificationService {
  /**
   * Show a notification about the Python-less version on first startup
   */
  static showPythonTransitionNotice(): void {
    try {
      // Check if we've already shown this notice
      const key = `${config.prefsPrefix}.notifiedPythonTransition`;
      const alreadyNotified = Zotero.Prefs.get(key, true);

      if (!alreadyNotified) {
        // Create a progress window for notification
        const progressWin = new ztoolkit.ProgressWindow(
          "Library Search Update",
          {
            closeOnClick: true,
            closeTime: 8000, // Show for 8 seconds
          },
        );

        progressWin.createLine({
          text: "Now using direct search implementation",
          type: "success",
          progress: 100,
        });

        progressWin.createLine({
          text: "Python script is no longer required",
          type: "default",
          progress: 100,
        });

        progressWin.show();

        // Mark as notified
        Zotero.Prefs.set(key, true, true);
      }
    } catch (e) {
      ztoolkit.log("Error showing Python transition notice:", e);
    }
  }

  /**
   * Show a notification when search is successful
   * @param count Number of results found
   */
  static showSearchSuccess(count: number): void {
    try {
      const progressWin = new ztoolkit.ProgressWindow("Library Search", {
        closeOnClick: true,
        closeTime: 3000,
      });

      progressWin.createLine({
        text: `Found ${count} result${count === 1 ? "" : "s"}`,
        type: "success",
        progress: 100,
      });

      progressWin.show();
    } catch (e) {
      ztoolkit.log("Error showing search success notification:", e);
    }
  }

  /**
   * Show a notification when search fails
   * @param error Error message
   */
  static showSearchError(error: string): void {
    try {
      const progressWin = new ztoolkit.ProgressWindow("Library Search", {
        closeOnClick: true,
        closeTime: 5000,
      });

      progressWin.createLine({
        text: "Search failed",
        type: "error",
        progress: 100,
      });

      progressWin.createLine({
        text: error.substring(0, 100), // Limit length to avoid UI issues
        type: "default",
        progress: 100,
      });

      progressWin.show();
    } catch (e) {
      ztoolkit.log("Error showing search error notification:", e);
    }
  }

  /**
   * Show a notification about successful import
   * @param count Number of items imported
   */
  static showImportSuccess(count: number): void {
    try {
      const progressWin = new ztoolkit.ProgressWindow("Library Search", {
        closeOnClick: true,
        closeTime: 3000,
      });

      progressWin.createLine({
        text: `Imported ${count} item${count === 1 ? "" : "s"}`,
        type: "success",
        progress: 100,
      });

      progressWin.show();
    } catch (e) {
      ztoolkit.log("Error showing import success notification:", e);
    }
  }
}
