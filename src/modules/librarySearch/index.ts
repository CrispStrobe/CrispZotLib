// src/modules/librarySearch/index.ts
// Main export file for library search functionality

// Export data models
export { BiblioRecord, SRUEndpoint, OAIEndpoint, IxTheoEndpoint } from './models';

// Export endpoints
export { SRU_ENDPOINTS, OAI_ENDPOINTS, IXTHEO_ENDPOINTS, NAMESPACES } from './endpoints';

// Export client classes
export { SRUClient, escapeQueryString } from './sruClient';
export { OAIClient } from './oaiClient';

// Export formatting functions
export {
  formatRecord,
  formatRecordBibtex,
  formatRecordRis,
  generateCitationKey
} from './formatters';

// Export search functionality
export { SearchService } from './searchService';
export { openSearchDialog } from './searchDialog';

// Export integration class
export { LibrarySearchIntegration } from './integration';

// Initialize the library search module
export function initializeLibrarySearch(): void {
  const { LibrarySearchIntegration } = require('./integration');
  LibrarySearchIntegration.init();
}