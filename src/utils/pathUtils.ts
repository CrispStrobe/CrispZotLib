// utils/pathUtils.ts
export class PathUtils {
  /**
   * Open a file picker dialog
   * @param type The type of file to pick
   * @returns Promise resolving to selected file path
   */
  static async selectFilePath(type: "executable" | "file"): Promise<string | undefined> {
    try {
      // Try to use FilePicker from ES modules (Zotero 7)
      try {
        const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
        
        const fp = new FilePicker();
        
        fp.init(
          Zotero.getMainWindow(),
          type === "executable" ? "Select Python Executable" : "Select Python Script", 
          fp.modeOpen
        );
        
        if (type === "executable") {
          if (Zotero.isWin) {
            fp.appendFilter("Executable", "*.exe");
          }
          fp.appendFilters(fp.filterAll);
        } else {
          fp.appendFilter("Python Scripts", "*.py");
          fp.appendFilters(fp.filterAll);
        }
        
        const rv = await fp.show();
        
        if (rv === fp.returnOK) {
          // Try various ways to get the file path
          if (fp.file?.path) {
            return fp.file.path;
          } else if ((fp as any).nativeFile?.path) {
            return (fp as any).nativeFile.path;
          } else if ((fp as any).mozFile?.path) {
            return (fp as any).mozFile.path;
          }
        }
        
        return undefined;
      } catch (e) {
        // Fall back to nsIFilePicker (Zotero 6)
        const fp = Components.classes["@mozilla.org/filepicker;1"]
          .createInstance(Components.interfaces.nsIFilePicker);
        
        fp.init(
          Zotero.getMainWindow(),
          type === "executable" ? "Select Python Executable" : "Select Python Script",
          Components.interfaces.nsIFilePicker.modeOpen
        );
        
        if (type === "executable") {
          if (Zotero.isWin) {
            fp.appendFilter("Executable", "*.exe");
          }
        } else {
          fp.appendFilter("Python Scripts", "*.py");
        }
        
        fp.appendFilter("All Files", "*");
        
        const rv = fp.show();
        if (rv === Components.interfaces.nsIFilePicker.returnOK) {
          return fp.file?.path;
        }
        
        return undefined;
      }
    } catch (e) {
      ztoolkit.log("Error selecting file:", e);
      throw new Error("Could not open file picker: " + e);
    }
  }
  
  // Other path utilities...
}