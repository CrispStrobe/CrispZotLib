# Zotero Library Search Plugin

This plugin allows you to search various library catalogs and repositories directly from Zotero using standard protocols like SRU, OAI-PMH, and IxTheo, and import the results directly into your library. It is self-contained and does not require any external script or Python installation. (See other github branch for leveraging the CrispLib python script.)

## Features

- Search multiple library catalogs using SRU, OAI-PMH, or IxTheo protocols.
- Choose from various endpoints including national libraries and specialized repositories.
- Import search results directly into your Zotero library.
- Support for Zotero's dark and light themes.
- Self-contained: No Python or external dependencies required.

## Installation

1.  Download the latest release `.xpi` file from the [Releases](https://github.com/CrispStrobe/CrispZotLib/releases) page.
2.  In Zotero, go to `Tools` → `Add-ons`.
3.  Click the gear icon and select "Install Add-on From File...".
4.  Select the downloaded `.xpi` file and click "Install".
5.  Restart Zotero if prompted.

## Configuration

Basic configuration options can be found in Zotero's preferences:

1.  Go to `Edit` → `Preferences` (or `Zotero` → `Settings` on macOS).
2.  Select the `Advanced` tab.
3.  Click the `Config Editor` button under "General".
4.  Search for `extensions.zotero.librarysearch`.
5.  You can enable/disable the plugin (`extensions.zotero.librarysearch.enable`) or toggle debug mode (`extensions.zotero.librarysearch.debugMode`).

**Note:** Unlike previous versions, there is no need to configure Python or script paths.

## Usage

1.  Click the "Search Libraries" button in the Zotero toolbar (icon looks like a magnifying glass over books) or go to `Tools` → `Library Search`.
2.  In the "Library Search" dialog:
    *   Select the `Protocol` (SRU, OAI-PMH, or IxTheo).
    *   Select the `Endpoint` (e.g., dnb, loc, crossref).
    *   For SRU, you can optionally select a specific `Schema Format` or leave it as "Endpoint Default".
    *   Enter your search terms (Title, Author, ISBN/ISSN).
    *   Set the `Max Results` you want to retrieve per page.
3.  Click "Search".
4.  A "Search Results" dialog will appear.
    *   Use the checkboxes to select items.
    *   Use the `< Previous` and `Next >` buttons to navigate through results if more than one page was found.
    *   Click "Import Selected" to import only the checked items.
    *   Click "Import All" to import all items currently displayed on the page.
    *   Click "Cancel" to close the dialog without importing.

## Supported Protocols and Endpoints

(This list remains the same as the protocols/endpoints themselves haven't changed, only the implementation method)

### SRU (Search/Retrieve via URL) Endpoints:
- **dnb**: German National Library
- **bnf**: French National Library
- **zdb**: Journal Database (Zeitschriftendatenbank)
- **loc**: Library of Congress
- **trove**: National Library of Australia
- **kb**: National Library of the Netherlands
- **bibsys**: Norwegian University Library (BIBSYS)

### OAI-PMH (Open Archives Initiative) Endpoints:
- **crossref**: CrossRef scholarly publishing
- **dnb**: German National Library OAI
- **dnb_digital**: German National Library Digital Collections
- **loc**: Library of Congress OAI
- **europeana**: European Digital Library
- **ddb**: German Digital Library
- **harvard**: Harvard Library
- **mit**: MIT DSpace
- **kitopen**: Karlsruhe Institute of Technology
- **arxiv**: ArXiv open access repository
- **doaj**: Directory of Open Access Journals

### IxTheo (Index Theologicus) Formats:
*(Searches IxTheo via HTML scraping and fetches details in the chosen format)*
- **ris**: RIS format export
- **marc**: MARC format export
- **html**: HTML detail page parsing

## Troubleshooting

- If searches fail, double-check that the selected `Endpoint` is appropriate for the chosen `Protocol`.
- Ensure your search terms are correctly formatted for the specific endpoint (some use specific prefixes like `TIT=`, others use quotation marks). Refer to the endpoint's documentation if unsure.
- Check Zotero's debug output for more detailed error messages (`Help` → `Debug Output Logging` → `Enable`).
- Ensure you have a stable internet connection.

## Building from Source

1.  Clone the repository: `git clone https://github.com/CrispStrobe/CrispZotLib.git`
2.  Navigate into the directory: `cd CrispZotLib`
3.  Install dependencies: `npm install`
4.  Build the plugin: `npm run build`
5.  The built `.xpi` file will be in the `build/` directory.

## Known Issues

- Still work in progress; not all endpoints may work perfectly with all query types or schemas.
- IxTheo search relies on HTML scraping and specific export URLs, which might break if the IxTheo website changes significantly.
- Very large result sets (especially with OAI-PMH over wide date ranges) might be slow or incomplete due to repository limitations.
- Error handling for specific endpoint issues could be improved.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.

## Acknowledgments

- [![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
- Zotero Plugin Toolkit developers.