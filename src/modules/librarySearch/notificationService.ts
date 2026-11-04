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
}
