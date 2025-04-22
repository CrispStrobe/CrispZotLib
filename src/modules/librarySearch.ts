// librarySearch.ts - Main entry point that exposes the module API

import { 
  BiblioRecord, 
  LibrarySearchIntegration, 
  initializeLibrarySearch 
} from './librarySearch/index';
import { SearchParams } from "./librarySearch/integration";

// Main module class exposed to Zotero
export class LibrarySearchModule {
  /**
   * Initialize the module
   */
  static init(): void {
    // Initialize the TypeScript library search implementation
    initializeLibrarySearch();
    
    // Add an initialization check to clean up any stale dialog references
    // Use _globalThis.addon instead of Zotero.__addonInstance__
    if (_globalThis.addon && _globalThis.addon.data.dialog) {
      try {
        if (_globalThis.addon.data.dialog.window && !_globalThis.addon.data.dialog.window.closed) {
          // Window still exists, keep it
        } else {
          // Window reference is stale, clear it
          _globalThis.addon.data.dialog = undefined;
        }
      } catch (e) {
        // Error accessing window, reference is invalid
        _globalThis.addon.data.dialog = undefined;
      }
    }
  }
  
  /**
   * Opens the search dialog to configure and run a library search
   */
  static async openSearchDialog(): Promise<void> {
    await LibrarySearchIntegration.openSearchDialog();
  }
  
  /**
   * Opens a dialog to display search results
   * Requires the results, the total number of records found, and the original search parameters.
   */
  static async openResultsDialog(
    results: BiblioRecord[],
    totalRecords: number,    
    searchParams: SearchParams 
  ): Promise<void> {
    // Pass all three arguments to the integration function
    await LibrarySearchIntegration.openResultsDialog(results, totalRecords, searchParams);
  }
  
  /**
   * Run a search with the given parameters
   */
  static async runSearch(searchParams: any): Promise<BiblioRecord[]> {
    try {
      const { 
        protocol, 
        endpoint, 
        title, 
        author, 
        isbn, 
        maxResults 
      } = searchParams;
      
      const params = {
        protocol: protocol || 'sru',
        endpoint: endpoint || 'dnb',
        title: title || undefined,
        author: author || undefined,
        isbn: isbn || undefined,
        maxRecords: maxResults || 10
      };
      
      const [success, results] = await LibrarySearchIntegration.executeSearch(params);
      
      if (!success || !results || results.length === 0) {
        throw new Error('No results found');
      }
      
      return results;
    } catch (error) {
      console.error('Error in runSearch:', error);
      throw error;
    }
  }
  
  /**
   * Import search results into Zotero
   */
  static async importResults(records: BiblioRecord[]): Promise<number> {
    if (!records || records.length === 0) {
      throw new Error('No results to import');
    }
    
    try {
      const importedCount = await LibrarySearchIntegration.importToZotero(records);
      return importedCount;
    } catch (error) {
      console.error('Error importing to Zotero:', error);
      throw error;
    }
  }
  
  /**
   * Opens the Library Search for API use
   */
  static openSearch(): void {
    // Use _globalThis.addon to access the addon object
    if (_globalThis.addon && _globalThis.addon.hooks) {
      _globalThis.addon.hooks.onDialogEvents("openSearch");
    } else {
      console.error("Could not access addon hooks");
    }
  }
}

// Export the module
export default LibrarySearchModule;