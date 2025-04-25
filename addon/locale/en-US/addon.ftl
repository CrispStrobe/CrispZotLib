# General strings
# startup-begin = Library Search: Starting plugin...
# startup-finish = Library Search: Plugin ready

# UI strings
# toolbar-button-label = Search Libraries
# toolbar-button-tooltip = Search library catalogs and repositories
# menu-item-label = Library Search

# Search dialog strings
search-dialog-title = Library Search
search-dialog-description = Search libraries and repositories for items to import into Zotero.
search-dialog-config-section = Configuration
search-dialog-python-path = Python Path:
search-dialog-script-path = Script Path:
search-dialog-search-section = Search Parameters
search-dialog-protocol = Protocol:
search-dialog-endpoint = Endpoint:

# SRU Specific (Example, might not be needed if handled dynamically)
# search-dialog-schema = Schema:
# search-dialog-schema-default = Endpoint Default
# search-dialog-schema-marcxml = MARCXML
# search-dialog-schema-dc = Dublin Core

# OAI Specific
search-dialog-oai-set = Set:
search-dialog-oai-update-sets = Update Sets
search-dialog-oai-prefix = Metadata Prefix:
search-dialog-oai-from = From Date:
search-dialog-oai-until = Until Date:

# Search / Filter Fields
search-dialog-allfields = All Fields:
search-dialog-allfields-disabled-oai-tooltip = "All Fields" search is not available for OAI-PMH protocol. Use specific fields or OAI harvesting options.
search-dialog-title-field = Title:
search-dialog-author = Author:
search-dialog-isbn = ISBN/ISSN:
search-dialog-max-results = Max Results:

# Buttons and Status
search-dialog-search-button = Search
search-dialog-cancel-button = Cancel
search-dialog-searching = Searching...
search-dialog-no-results = No results found
search-dialog-error = An error occurred during search

# Results dialog strings
results-dialog-title = Search Results
results-dialog-import-selected = Import Selected
results-dialog-import-all = Import All
results-dialog-cancel = Cancel
results-dialog-no-selection = Please select at least one item to import
results-dialog-import-success = Items successfully imported
results-dialog-import-error = Error importing items

# Error messages
search-error-missing-paths = Python path and script path must be set
search-error-missing-endpoint = Endpoint must be specified
search-error-missing-search-terms = At least one search term must be provided
search-error-script-failed = Search script execution failed
search-error-invalid-results = Invalid results returned from search script