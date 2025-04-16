# Zotero Library Search Plugin

This plugin allows you to search various library catalogs and repositories directly from Zotero and import the results into your library.

## Features

- Search multiple library catalogs using the SRU, OAI-PMH, or IxTheo protocols
- Choose from various endpoints including national libraries and specialized repositories
- Import search results directly into your Zotero library
- Configure the plugin to use your local Python installation and search script

## Installation

1. Download the latest release `.xpi` file from the [Releases](https://github.com/CrispStrobe/CrispZotLib/releases) page
2. In Zotero, go to Tools → Add-ons
3. Click the gear icon and select "Install Add-on From File..."
4. Select the downloaded `.xpi` file

## Configuration

After installation, you'll need to configure the plugin to work with the library search script:

1. Ensure you have Python installed on your system
2. Download the library search script and its dependencies from [Library Search](https://github.com/CrispStrobe/CrispZotLib/)
3. In Zotero, go to Edit → Preferences → Library Search
4. Set the Python path to your Python executable (e.g., `/usr/bin/python` or `C:\Python\python.exe`)
5. Set the script path to the path of the downloaded `library_search.py` script

## Usage

1. Click the "Search Libraries" button in the Zotero toolbar or go to Tools → Library Search
2. Select the protocol and endpoint you want to search
3. Enter your search terms (title, author, ISBN, etc.)
4. Click Search
5. Select the results you want to import and click "Import Selected" or "Import All"

## Supported Search Protocols

- **SRU (Search/Retrieve via URL)**: A standard search protocol used by many libraries
- **OAI-PMH (Open Archives Initiative Protocol for Metadata Harvesting)**: A protocol for harvesting metadata from repositories
- **IxTheo**: Specialized protocol for searching theological resources

## Building from Source

To build the plugin from source:

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. The built `.xpi` file will be in the `build` directory

## Credits

This plugin uses the library search script developed for searching various library catalogs and repositories.

## License

This project is licensed under the MIT License - see the LICENSE file for details.