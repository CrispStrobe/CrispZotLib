// src/modules/librarySearch/index.ts
// Main export file for library search functionality

// Export data models
export {
  BiblioRecord,
  SRUEndpoint,
  OAIEndpoint,
  IxTheoEndpoint,
} from "./models";

// Export endpoints
export {
  SRU_ENDPOINTS,
  OAI_ENDPOINTS,
  IXTHEO_ENDPOINTS,
  NAMESPACES,
} from "./endpoints";

// Export client classes
export { SRUClient, escapeQueryString } from "./sruClient";
export { OAIClient } from "./oaiClient";

// Export formatting functions
export {
  formatRecord,
  formatRecordBibtex,
  formatRecordRis,
  generateCitationKey,
} from "./formatters";

// Export search functionality
export { SearchService } from "./searchService";
export { openSearchDialog } from "./searchDialog";

// Export integration class
export { LibrarySearchIntegration } from "./integration";

// Export identifier resolution (DOI / PMID / ISBN / URL -> BiblioRecord)
export {
  resolveIdentifier,
  detectIdentifierType,
  resolveDoi,
  resolvePmid,
  resolveIsbn,
  resolveUrl,
} from "./identifierResolver";

// Initialize the library search module
export function initializeLibrarySearch(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require avoids a circular import at module load
  const { LibrarySearchIntegration } = require("./integration");
  LibrarySearchIntegration.init();
}
