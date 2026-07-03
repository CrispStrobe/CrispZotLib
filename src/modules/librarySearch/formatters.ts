// formatters.ts - Formatting functions for bibliographic data

import { BiblioRecord } from './models';

// Generate a citation key from a bibliographic record
export function generateCitationKey(record: BiblioRecord): string {
  // Get first author's last name or 'unknown' if no authors
  let authorKey = 'unknown';
    
  if (record.authors && record.authors.length > 0) {
    // Extract last name from first author
    const firstAuthor = record.authors[0];
    
    // Clean the name - remove role indicators
    let cleanName = firstAuthor.replace(/\s*\[[^\]]*\]/g, '');
    // Fix broken brackets
    cleanName = cleanName.replace(/\]\s*$/g, '');
    cleanName = cleanName.replace(/^\s*\[/g, '');
    
    if (cleanName.includes(',')) {
      authorKey = cleanName.split(',')[0].trim().toLowerCase();
    } else {
      // Take the last word as the last name
      const parts = cleanName.split(' ');
      authorKey = parts.length > 0 ? parts[parts.length - 1].toLowerCase() : 'unknown';
    }
  } else if (record.editors && record.editors.length > 0) {
    // Use first editor if no authors
    const firstEditor = record.editors[0];
    
    // Clean the name
    let cleanName = firstEditor.replace(/\s*\[[^\]]*\]/g, '');
    // Fix broken brackets
    cleanName = cleanName.replace(/\]\s*$/g, '');
    cleanName = cleanName.replace(/^\s*\[/g, '');
    
    if (cleanName.includes(',')) {
      authorKey = cleanName.split(',')[0].trim().toLowerCase();
    } else {
      const parts = cleanName.split(' ');
      authorKey = parts.length > 0 ? parts[parts.length - 1].toLowerCase() : 'editor';
    }
  }
  
  // Remove any non-alphanumeric characters
  authorKey = authorKey.replace(/[^a-z0-9]/g, '');
  
  // If authorKey is empty after cleaning, use 'unknown'
  if (!authorKey) {
    authorKey = 'unknown';
  }
  
  // Add year if available
  if (record.year) {
    return `${authorKey}${record.year}`;
  }
  
  return authorKey;
}

// Escape BibTeX-special characters in a prose value. Applied to text fields
// (title, names, journal, publisher, series, note). NOT applied to url/doi/isbn,
// where a backslash escape would corrupt the identifier.
function escapeBibtex(value: string): string {
  return value.replace(/([#$%&_{}])/g, '\\$1');
}

// RIS is a line-based format: an embedded newline in a value (common in abstracts)
// splits it into malformed tag-less lines. Collapse newlines to spaces.
function sanitizeRisValue(value: string): string {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

// Canonical mapping from a BiblioRecord to a Zotero item type. `document_type`
// (computed by the SRU/OAI parsers) wins; otherwise fall back to heuristics.
// ISBN is checked before ISSN so a book carrying a series ISSN is not
// mis-classified as a journal article. Shared by the export and import paths.
export function mapRecordToItemType(record: BiblioRecord): string {
  const dt = (record.document_type || '').toLowerCase();
  if (dt) {
    if (dt.includes('article')) return 'journalArticle';
    if (dt.includes('chapter') || dt.includes('section')) return 'bookSection';
    if (dt.includes('thesis') || dt.includes('dissertation')) return 'thesis';
    if (dt.includes('conference') || dt.includes('proceeding')) return 'conferencePaper';
    if (dt.includes('report')) return 'report';
    if (dt.includes('map')) return 'map';
    if (dt.includes('video') || dt.includes('film') || dt.includes('movingimage'))
      return 'videoRecording';
    if (dt.includes('audio') || dt.includes('music') || dt.includes('sound'))
      return 'audioRecording';
    if (dt.includes('image') || dt.includes('artwork')) return 'artwork';
    if (dt.includes('computer') || dt.includes('software') || dt.includes('dataset'))
      return 'computerProgram';
    if (dt.includes('book')) return 'book';
    if (dt.includes('journal')) return record.journal_title ? 'journalArticle' : 'book';
  }
  if (record.journal_title) return 'journalArticle';
  if (record.isbn) return 'book';
  if (record.issn) return 'journalArticle';
  return 'book';
}

// Format a record as BibTeX citation
export function formatRecordBibtex(record: BiblioRecord): string {
  // Get citation key
      const citationKey = generateCitationKey(record);
      
      // Determine entry type
      let entryType = "book"; // Default
      if (record.document_type) {
        const docType = record.document_type.toLowerCase();
        if (docType.includes("article")) {
          entryType = "article";
        } else if (docType.includes("chapter")) {
          entryType = "incollection";
        } else if (docType.includes("thesis")) {
          entryType = "phdthesis";
        } else if (docType.includes("proceedings")) {
          entryType = "inproceedings";
        } else if (docType.includes("report")) {
          entryType = "techreport";
        }
      } else if (record.journal_title) {
        entryType = "article";
      }
      
      // Start building BibTeX
      const bibtex: string[] = [`@${entryType}{${citationKey},`];
      
      // Clean up the title
      // Remove trailing author information after '/'
      let title = record.title.replace(/\s*\/\s*[^/]+$/, '');
      // Escape special characters for BibTeX
      title = escapeBibtex(title);
      bibtex.push(`  title = {${title}},`);
      
      // Authors
      if (record.authors && record.authors.length > 0) {
        // Format authors properly for BibTeX
        const authorsList = record.authors.map(escapeBibtex).join(" and ");
        bibtex.push(`  author = {${authorsList}},`);
      }
      
      // Editors
      if (record.editors && record.editors.length > 0) {
        // Format editors properly for BibTeX
        const editorsList = record.editors.map(escapeBibtex).join(" and ");
        bibtex.push(`  editor = {${editorsList}},`);
      }
      
      // Translators (not a standard BibTeX field, but we'll include it as a note)
      if (record.translators && record.translators.length > 0) {
        const translatorsList = record.translators.map(escapeBibtex).join(" and ");
        bibtex.push(`  translator = {${translatorsList}},`);
      }
      
      // Year
      if (record.year) {
        bibtex.push(`  year = {${record.year}},`);
      }
      
      // Journal for articles
      if (entryType === "article" && record.journal_title) {
        bibtex.push(`  journal = {${escapeBibtex(record.journal_title)}},`);
        
        // Volume
        if (record.volume) {
          bibtex.push(`  volume = {${record.volume}},`);
        }
        
        // Issue/Number
        if (record.issue) {
          bibtex.push(`  number = {${record.issue}},`);
        }
      }
      
      // Publisher
      if (record.publisher_name) {
        bibtex.push(`  publisher = {${escapeBibtex(record.publisher_name)}},`);
      }
      
      // Address (place of publication)
      if (record.place_of_publication) {
        bibtex.push(`  address = {${escapeBibtex(record.place_of_publication)}},`);
      }
      
      // Series
      if (record.series) {
        bibtex.push(`  series = {${escapeBibtex(record.series)}},`);
      }
      
      // ISBN
      if (record.isbn) {
        bibtex.push(`  isbn = {${record.isbn}},`);
      }
      
      // ISSN for journals
      if (entryType === "article" && record.issn) {
        bibtex.push(`  issn = {${record.issn}},`);
      }
      
      // DOI
      if (record.doi) {
        bibtex.push(`  doi = {${record.doi}},`);
      }
      
      // Pages
      if (record.pages) {
        bibtex.push(`  pages = {${record.pages}},`);
      }
      
      // Edition
      if (record.edition) {
        bibtex.push(`  edition = {${record.edition}},`);
      }
      
      // URL (use the first one if multiple are available)
      if (record.urls && record.urls.length > 0) {
        bibtex.push(`  url = {${record.urls[0]}},`);
      }
      
      // Language
      if (record.language) {
        bibtex.push(`  language = {${record.language}},`);
      }
      
      // Add record ID in note field for reference
      bibtex.push(`  note = {ID: ${escapeBibtex(record.id)}}`);
      
      // Close the entry
      bibtex.push("}");
      
      return bibtex.join("\n");
}

// Format a record as RIS citation
export function formatRecordRis(record: BiblioRecord): string {
  // Determine record type
      let recordType = "BOOK";  // Default to book
      if (record.issn || record.journal_title) {
        recordType = "JOUR";  // Journal article
      } else if (record.series && record.document_type?.toLowerCase().includes("chapter")) {
        recordType = "CHAP";  // Book chapter
      }
      
      // Start building RIS entry
      const ris: string[] = [`TY  - ${recordType}`];
      
      // Add ID
      ris.push(`ID  - ${record.id}`);
      
      // Add title
      ris.push(`TI  - ${sanitizeRisValue(record.title)}`);
      
      // Add authors
      for (const author of record.authors) {
        // For RIS, typically format is "lastname, firstname"
        if (author.includes(',')) {
          ris.push(`AU  - ${author}`);
        } else {
          // Convert "firstname lastname" to "lastname, firstname"
          const parts = author.split(' ');
          if (parts.length > 1) {
            const lastName = parts[parts.length - 1];
            const firstNames = parts.slice(0, parts.length - 1).join(' ');
            ris.push(`AU  - ${lastName}, ${firstNames}`);
          } else {
            ris.push(`AU  - ${author}`);
          }
        }
      }
      
      // Add editors
      for (const editor of record.editors) {
        // Format similarly to authors
        if (editor.includes(',')) {
          ris.push(`ED  - ${editor}`);
        } else {
          const parts = editor.split(' ');
          if (parts.length > 1) {
            const lastName = parts[parts.length - 1];
            const firstNames = parts.slice(0, parts.length - 1).join(' ');
            ris.push(`ED  - ${lastName}, ${firstNames}`);
          } else {
            ris.push(`ED  - ${editor}`);
          }
        }
      }
      
      // Add year
      if (record.year) {
        ris.push(`PY  - ${record.year}`);
        ris.push(`Y1  - ${record.year}///`);  // Year with // for month/day
      }
      
      // Add publisher
      if (record.publisher_name) {
        ris.push(`PB  - ${record.publisher_name}`);
      }
      
      // Add place of publication
      if (record.place_of_publication) {
        ris.push(`CY  - ${record.place_of_publication}`);
      }
      
      // Add ISBN
      if (record.isbn) {
        ris.push(`SN  - ${record.isbn}`);
      }
      
      // Add ISSN
      if (record.issn) {
        ris.push(`SN  - ${record.issn}`);
      }
      
      // Add edition
      if (record.edition) {
        ris.push(`ET  - ${record.edition}`);
      }
      
      // Add series or journal title
      if (recordType === "JOUR" && record.journal_title) {
        ris.push(`JO  - ${record.journal_title}`);
        ris.push(`T2  - ${record.journal_title}`);
      } else if (record.series) {
        ris.push(`T2  - ${record.series}`);
      }
      
      // Add volume
      if (record.volume) {
        ris.push(`VL  - ${record.volume}`);
      }
      
      // Add issue
      if (record.issue) {
        ris.push(`IS  - ${record.issue}`);
      }
      
      // Add pages
      if (record.pages) {
        ris.push(`SP  - ${record.pages}`);
      }
      
      // Add language
      if (record.language) {
        ris.push(`LA  - ${record.language}`);
      }
      
      // Add DOI
      if (record.doi) {
        ris.push(`DO  - ${record.doi}`);
      }
      
      // Add URLs
      if (record.urls && record.urls.length > 0) {
        for (const url of record.urls) {
          ris.push(`UR  - ${url}`);
        }
      }
      
      // Add abstract
      if (record.abstract) {
        ris.push(`AB  - ${sanitizeRisValue(record.abstract)}`);
      }
      
      // Add keywords (from subjects)
      if (record.subjects && record.subjects.length > 0) {
        for (const subject of record.subjects) {
          ris.push(`KW  - ${subject}`);
        }
      }
      
      // Add notes for format info
      if (record.format) {
        ris.push(`N1  - Format: ${record.format}`);
      }
      
      // Add extent information
      if (record.extent) {
        ris.push(`N1  - Extent: ${record.extent}`);
      }
      
      // End record
      ris.push("ER  - ");
      
      return ris.join("\n");
}

// A parsed creator name. Either two-field (firstName/lastName) for personal names,
// or single-field (name + fieldMode 1) for corporate/organizational/mononym names.
export interface ParsedCreatorName {
  firstName?: string;
  lastName?: string;
  name?: string;
  fieldMode?: number;
}

// Substrings that mark a name as an organization rather than a person. Corporate
// authors ("United Nations", "Deutsche Nationalbibliothek") must not be split into
// first/last — that produces nonsense like "Nations, United".
const CORPORATE_MARKERS =
  // Substring markers (compound-safe, esp. German compounds like "Nationalbibliothek")
  // OR short word-bounded tokens that would false-positive as substrings.
  /(univ(?:ersit)?|institut|department|abteilung|minist|organi[sz]ation|associat|society|gesellschaft|foundation|stiftung|verlag|bibliothek|library|committee|commission|kommission|council|corporation|gmbh|publish|verein|hochschule|akademie|academy|bundes|united nations|european union)|(\b(?:inc|ltd|ag|co|plc|llc|who|unesco|oecd|office|bureau|agency|company|press)\b)/i;

/**
 * Split a raw creator string into Zotero creator fields.
 * - "Last, First"  -> { lastName, firstName }
 * - "First Last"   -> { lastName, firstName }
 * - Corporate/single-token names -> single-field { name, fieldMode: 1 }
 */
export function parseCreatorName(raw: string): ParsedCreatorName {
  const name = (raw || '').trim();
  if (!name) return { name: '', fieldMode: 1 };
  if (name.includes(',')) {
    const idx = name.indexOf(',');
    return { lastName: name.slice(0, idx).trim(), firstName: name.slice(idx + 1).trim() };
  }
  if (CORPORATE_MARKERS.test(name)) return { name, fieldMode: 1 };
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { name, fieldMode: 1 }; // mononym -> single field
  return { lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(' ') };
}

// Format a record for display or export in the specified format
export function formatRecord(record: BiblioRecord, format: string = 'text', includeRaw: boolean = false): string {
  switch (format.toLowerCase()) {
        case 'json': {
          const data = { ...record };
          if (!includeRaw) {
            delete data.raw_data;
          }
          return JSON.stringify(data, null, 2);
        }
        
        case 'bibtex':
          return formatRecordBibtex(record);
        
        case 'ris':
          return formatRecordRis(record);
        
        case 'zotero': {
          // For Zotero, create a JSON structure with specific Zotero-compatible fields
          const zoteroData: any = {
            itemType: mapRecordToItemType(record),
            title: record.title,
            creators: [],
            date: record.year,
            publisher: record.publisher_name,
            place: record.place_of_publication,
            ISBN: record.isbn,
            ISSN: record.issn,
            series: record.series,
            edition: record.edition,
            language: record.language,
            url: record.urls && record.urls.length > 0 ? record.urls[0] : "",
            abstractNote: record.abstract,
            tags: record.subjects ? record.subjects.map(subject => ({ tag: subject })) : [],
            notes: []
          };
          
          // Format creators for Zotero (corporate/mononym names kept single-field)
          for (const author of record.authors) {
            zoteroData.creators.push({ creatorType: "author", ...parseCreatorName(author) });
          }
          for (const editor of record.editors) {
            zoteroData.creators.push({ creatorType: "editor", ...parseCreatorName(editor) });
          }
          
          // Add journal article specific fields
          if (record.journal_title) {
            zoteroData.publicationTitle = record.journal_title;
            zoteroData.volume = record.volume;
            zoteroData.issue = record.issue;
            zoteroData.pages = record.pages;
          }
          
          return JSON.stringify(zoteroData, null, 2);
        }

        default: { // text format
          // Create a nicely formatted text representation
          const result: string[] = [];
          result.push(`Title: ${record.title}`);
          
          if (record.authors && record.authors.length > 0) {
            result.push(`Author(s): ${record.authors.join(", ")}`);
          }
          
          if (record.editors && record.editors.length > 0) {
            result.push(`Editor(s): ${record.editors.join(", ")}`);
          }
          
          if (record.year) {
            result.push(`Year: ${record.year}`);
          }
          
          if (record.place_of_publication) {
            result.push(`Place of Publication: ${record.place_of_publication}`);
          }
          
          if (record.publisher_name) {
            result.push(`Publisher: ${record.publisher_name}`);
          }
          
          if (record.edition) {
            result.push(`Edition: ${record.edition}`);
          }
          
          if (record.series) {
            result.push(`Series: ${record.series}`);
          }
          
          if (record.extent) {
            result.push(`Extent: ${record.extent}`);
          }
          
          // Add journal information for articles
          if (record.journal_title) {
            result.push(`Journal Title: ${record.journal_title}`);
            if (record.volume) {
              result.push(`Volume: ${record.volume}`);
            }
            if (record.issue) {
              result.push(`Issue: ${record.issue}`);
            }
            if (record.pages) {
              result.push(`Pages: ${record.pages}`);
            }
          }
          
          if (record.isbn) {
            result.push(`ISBN: ${record.isbn}`);
          }
          
          if (record.issn) {
            result.push(`ISSN: ${record.issn}`);
          }
          
          if (record.language) {
            result.push(`Language: ${record.language}`);
          }
          
          if (record.subjects && record.subjects.length > 0) {
            // Display up to 5 subjects for readability
            const subjectsToShow = record.subjects.slice(0, 5);
            const remainingCount = record.subjects.length - 5;
            
            let subjectsText = subjectsToShow.join(", ");
            if (remainingCount > 0) {
              subjectsText += `, ... (${remainingCount} more)`;
            }
            
            result.push(`Subjects: ${subjectsText}`);
          }
          
          if (record.urls && record.urls.length > 0) {
            // Format URLs for better readability
            if (record.urls.length === 1) {
              result.push(`URL: ${record.urls[0]}`);
            } else {
              result.push("URLs:");
              for (const url of record.urls) {
                result.push(`  - ${url}`);
              }
            }
          }
          
          if (record.abstract) {
            // Truncate long abstracts
            let abstract = record.abstract;
            if (abstract.length > 300) {
              abstract = abstract.substring(0, 297) + "...";
            }
            result.push(`Abstract: ${abstract}`);
          }
          
          // Show format information if available
          if (record.format) {
            result.push(`Format: ${record.format}`);
          }
          
          // Show raw data if requested
          if (includeRaw && record.raw_data) {
            result.push("\nRaw Data:");
            // Limit raw data length to prevent overwhelming display
            let rawData = record.raw_data;
            if (rawData.length > 2000) {
              rawData = rawData.substring(0, 1997) + "...";
            }
            result.push(rawData);
          }
          
          return result.join("\n");
        }
      }
}