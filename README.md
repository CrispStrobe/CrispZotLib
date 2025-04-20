# Zotero Library Search Plugin

This plugin allows you to search various library catalogs and repositories directly from Zotero and import the results into your library.

## Features

- Search multiple library catalogs using the SRU, OAI-PMH, or IxTheo protocols
- Choose from various endpoints including national libraries and specialized repositories
- Import search results directly into your Zotero library
- Support for dark and light themes
- Simple configuration using your existing Python installation

## Installation

1. Download the latest release `.xpi` file from the [Releases](https://github.com/CrispStrobe/CrispZotLib/releases) page
2. In Zotero, go to Tools → Add-ons
3. Click the gear icon and select "Install Add-on From File..."
4. Select the downloaded `.xpi` file

## Configuration

After installation, you'll need to configure the plugin:

1. Ensure you have Python 3.6+ installed on your system
2. Download the library search script from [CrispLib Repository](https://github.com/CrispStrobe/CrispLib/)
3. In Zotero, click the "Search Libraries" button in the toolbar or go to Tools → Library Search
4. Set the Python path to your Python executable:
   - macOS: typically `/usr/bin/python3` or `/opt/homebrew/bin/python3` or `~/miniconda3/bin/python`
   - Windows: typically `C:\Python\python.exe` or `C:\Users\<username>\AppData\Local\Programs\Python\Python310\python.exe`
   - Linux: typically `/usr/bin/python3`
5. Set the script path to the path of the downloaded `library_search.py` script

## Usage

1. Click the "Search Libraries" button in the Zotero toolbar or go to Tools → Library Search
2. Select the protocol and endpoint you want to search
3. Enter your search terms (title, author, ISBN, etc.)
4. Set the maximum number of results (default: 10)
5. Click "Search"
6. From the results dialog, select items to import and click "Import Selected" or "Import All"

## Supported Protocols and Endpoints

### SRU (Search/Retrieve via URL) Endpoints:
- **dnb**: German National Library
- **bnf**: French National Library
- **zdb**: Journal Database (Zeitschriftendatenbank)
- **loc**: Library of Congress
- **trove**: National Library of Australia
- **kb**: National Library of Sweden
- **bibsys**: Norwegian University Library

### OAI-PMH (Open Archives Initiative) Endpoints:
- **crossref**: CrossRef scholarly publishing
- **dnb**: German National Library
- **dnb_digital**: German National Library Digital Collections
- **loc**: Library of Congress
- **europeana**: European Digital Library
- **ddb**: German Digital Library
- **harvard**: Harvard University
- **mit**: Massachusetts Institute of Technology
- **kitopen**: Karlsruhe Institute of Technology
- **arxiv**: ArXiv open access repository
- **doaj**: Directory of Open Access Journals

### IxTheo (Index Theologicus) Formats:
- **ris**: RIS format
- **marc**: MARC format
- **html**: HTML format

## Troubleshooting

If you encounter issues with the search:

1. Verify your Python path is correct by running it from the command line
2. Check that the library_search.py script path is correct
3. Ensure you have the necessary Python dependencies installed:
   ```
   pip install requests lxml pymarc
   ```

## Building from Source

To build the plugin from source:

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. The built `.xpi` file will be in the `build` directory

## Known Issues

- Still work in progress, not all endpoints work correctly on all protocols
- especially manually tweak search parameters to avoid too many results
- Very large result sets may take longer to process
  
## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)