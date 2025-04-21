// models.ts - Define data models for the library search functionality

// Main bibliographic record interface
export interface BiblioRecord {
  id: string;
  title: string;
  authors: string[];
  editors: string[];
  translators: string[];
  contributors: Array<{name: string; role: string}>;
  year?: string;
  publisher_name?: string;
  place_of_publication?: string;
  isbn?: string;
  issn?: string;
  urls: string[];
  abstract?: string;
  language?: string;
  format?: string;
  subjects: string[];
  series?: string;
  extent?: string;
  edition?: string;
  journal_title?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  document_type?: string;
  raw_data?: string;
  schema?: string;
}

// Endpoint definitions
export interface SRUEndpoint {
  name: string;
  url: string;
  defaultSchema?: string;
  version?: string;
  description?: string;
  examples?: Record<string, any>;
}

export interface OAIEndpoint {
  name: string;
  url: string;
  defaultMetadataPrefix?: string;
  description?: string;
  sets?: Record<string, string>;
}

export interface IxTheoEndpoint {
  name: string;
  url: string;
  description: string;
  formats?: string[];
  languages?: string[];
  export_formats?: string[];
}