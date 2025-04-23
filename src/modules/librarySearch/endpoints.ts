// endpoints.ts - Define all supported endpoints

import { SRUEndpoint, OAIEndpoint, IxTheoEndpoint } from './models';

// XML Namespaces
export const NAMESPACES: Record<string, string> = {
  // SRU namespaces
  'srw': 'http://www.loc.gov/zing/srw/',
  'sd': 'http://www.loc.gov/zing/srw/diagnostic/',
  
  // Dublin Core
  'dc': 'http://purl.org/dc/elements/1.1/',
  'dcterms': 'http://purl.org/dc/terms/',
  
  // MARC
  'marc': 'http://www.loc.gov/MARC21/slim',
  'mxc': 'info:lc/xmlns/marcxchange-v2',
  
  // XML Schema
  'xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  'xsd': 'http://www.w3.org/2001/XMLSchema#',
  
  // RDF and related vocabularies
  'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
  'owl': 'http://www.w3.org/2002/07/owl#',
  'skos': 'http://www.w3.org/2004/02/skos/core#',
  'foaf': 'http://xmlns.com/foaf/0.1/',
  'bibo': 'http://purl.org/ontology/bibo/',
  'schema': 'http://schema.org/',
  
  // Library specific
  'gndo': 'https://d-nb.info/standards/elementset/gnd#',
  'marcRole': 'http://id.loc.gov/vocabulary/relators/',
  'rdau': 'http://rdaregistry.info/Elements/u/',
  'isbd': 'http://iflastandards.info/ns/isbd/elements/',
  'umbel': 'http://umbel.org/umbel#',
  'gbv': 'http://purl.org/ontology/gbv/'
};

// Define SRU endpoints

// Define the endpoints
  export const SRU_ENDPOINTS: Record<string, SRUEndpoint> = {
    // National Libraries
    'dnb': {
      name: 'Deutsche Nationalbibliothek',
      url: 'https://services.dnb.de/sru/dnb',
      defaultSchema: 'RDFxml',
      description: 'The German National Library',
      version: '1.1',
      examples: {
        'title': 'TIT=Python',
        'author': 'PER=Einstein',
        'isbn': 'ISBN=9783658310844',
        'advanced': {'TIT': 'Python', 'JHR': '2023'}
      }
    },
    'bnf': {
      name: 'Bibliothèque nationale de France',
      url: 'http://catalogue.bnf.fr/api/SRU',
      defaultSchema: 'dublincore',
      description: 'The French National Library',
      version: '1.2',
      examples: {
        'title': 'bib.title any "Python"',
        'author': 'bib.author any "Einstein"',
        'isbn': 'bib.isbn any "9782012919198"',
        'advanced': 'bib.title any "Python" and bib.date any "2023"'
      }
    },
    'zdb': {
      name: 'ZDB - German Union Catalogue of Serials',
      url: 'https://services.dnb.de/sru/zdb',
      defaultSchema: 'MARC21-xml',
      description: 'German Union Catalogue of Serials',
      version: '1.1',
      examples: {
        'title': 'TIT=Journal',
        'issn': 'ISS=0740-171x',
        'advanced': {'TIT': 'Journal', 'JHR': '2023'}
      }
    },
    'loc': {
      name: 'Library of Congress',
      url: 'https://lccn.loc.gov/sru',
      defaultSchema: 'marcxml',
      description: 'Library of Congress catalog',
      version: '1.1',
      examples: {
        'title': 'title="Python"',
        'author': 'author="Einstein"',
        'isbn': 'isbn=9781234567890',
        'advanced': 'title="Python" and author="Rossum"'
      }
    },
    'trove': {
      name: 'Trove (National Library of Australia)',
      url: 'http://www.nla.gov.au/apps/srw/search/peopleaustralia',
      defaultSchema: 'dc',
      description: 'Australia\'s cultural collections',
      version: '1.1',
      examples: {
        'name': 'bath.name="Smith"',
        'advanced': 'pa.surname="Smith" and pa.firstname="John"'
      }
    },
    'kb': {
      name: 'KB - National Library of the Netherlands',
      url: 'http://jsru.kb.nl/sru',
      defaultSchema: 'dc',
      description: 'Dutch National Library',
      version: '1.1',
      examples: {
        'title': 'dc.title=Python',
        'advanced': 'dc.title=Python and dc.date=2023'
      }
    },
    'bibsys': {
      name: 'BIBSYS - Norwegian Library Service',
      url: 'http://sru.bibsys.no/search/biblio',
      defaultSchema: 'dc',
      description: 'Norwegian academic libraries',
      version: '1.1',
      examples: {
        'title': 'title="Python"',
        'author': 'author="Einstein"',
        'advanced': 'title="Python" and date="2023"'
      }
    }
  };
  
  export const OAI_ENDPOINTS: Record<string, OAIEndpoint> = {
    'crossref': {
      name: 'Crossref',
      url: 'https://api.crossref.org/oai',
      defaultMetadataPrefix: 'crossref',
      description: 'Crossref metadata database',
      sets: {}
    },
    'dnb': {
      name: 'Deutsche Nationalbibliothek OAI',
      url: 'https://services.dnb.de/oai/repository',
      defaultMetadataPrefix: 'oai_dc',
      description: 'German National Library OAI-PMH service',
      sets: {
        'dnb:reiheC': 'Series C - Dissertations',
        'dnb:reiheH': 'Series H - University Publications',
        'dnb:reiheN': 'Series N - German Translations'
      }
    },
    'dnb_digital': {
      name: 'DNB Digital',
      url: 'https://services.dnb.de/oai/repository_digital',
      defaultMetadataPrefix: 'oai_dc',
      description: 'Digital collections of the German National Library',
      sets: {}
    },
    'loc': {
      name: 'Library of Congress OAI',
      url: 'https://memory.loc.gov/cgi-bin/oai2_0',
      defaultMetadataPrefix: 'oai_dc',
      description: 'Library of Congress OAI-PMH repository',
      sets: {}
    },
    'europeana': {
      name: 'Europeana',
      url: 'https://api.europeana.eu/oai/record',
      defaultMetadataPrefix: 'edm',
      description: 'European digital cultural heritage',
      sets: {}
    },
    'ddb': {
      name: 'Deutsche Digitale Bibliothek',
      url: 'https://api.deutsche-digitale-bibliothek.de/oai',
      defaultMetadataPrefix: 'oai_dc',
      description: 'German Digital Library',
      sets: {}
    },
    'harvard': {
      name: 'Harvard Library',
      url: 'https://iiif.lib.harvard.edu/oai/oai2.php',
      defaultMetadataPrefix: 'oai_dc',
      description: 'Harvard Library collections',
      sets: {}
    },
    'mit': {
      name: 'MIT DSpace',
      url: 'https://dspace.mit.edu/oai/request',
      defaultMetadataPrefix: 'oai_dc',
      description: 'MITs DSpace repository',
      sets: {}
    },
    'kitopen': {
      name: 'KITopen',
      url: 'https://www.bibliothek.kit.edu/oai/kit.php',
      defaultMetadataPrefix: 'oai_dc',
      description: 'KIT (Karlsruhe Institute of Technology) repository',
      sets: {}
    },
    'arxiv': {
      name: 'arXiv',
      url: 'http://export.arxiv.org/oai2',
      defaultMetadataPrefix: 'oai_dc',
      description: 'arXiv.org e-Print archive',
      sets: {
        'physics': 'Physics',
        'math': 'Mathematics',
        'cs': 'Computer Science',
        'q-bio': 'Quantitative Biology',
        'q-fin': 'Quantitative Finance',
        'stat': 'Statistics'
      }
    },
    'doaj': {
      name: 'DOAJ (Directory of Open Access Journals)',
      url: 'https://www.doaj.org/oai',
      defaultMetadataPrefix: 'oai_dc',
      description: 'Directory of Open Access Journals',
      sets: {}
    }
  };
  
  export const IXTHEO_ENDPOINTS: Record<string, IxTheoEndpoint> = {
    'ris': {
      name: 'IxTheo RIS Format',
      url: 'https://ixtheo.de/Search/Results',
      baseUrl: 'https://ixtheo.de',           // Base domain URL
      description: 'Index Theologicus with RIS export',
      formats: ['Article', 'Book', 'Book Chapter', 'Journal', 'Review', 'Thesis'],
      languages: ['German', 'English', 'French', 'Italian', 'Spanish', 'Latin', 'Greek', 'Hebrew']
    },
    'marc': {
      name: 'IxTheo MARC Format',
      url: 'https://ixtheo.de/Search/Results',
      baseUrl: 'https://ixtheo.de',           // Base domain URL
      description: 'Index Theologicus with MARC export',
      formats: ['Article', 'Book', 'Book Chapter', 'Journal', 'Review', 'Thesis'],
      languages: ['German', 'English', 'French', 'Italian', 'Spanish', 'Latin', 'Greek', 'Hebrew']
    },
    'html': {
      name: 'IxTheo HTML Format',
      url: 'https://ixtheo.de/Search/Results',
      description: 'Index Theologicus with HTML parse',
      baseUrl: 'https://ixtheo.de',           // Base domain URL
      formats: ['Article', 'Book', 'Book Chapter', 'Journal', 'Review', 'Thesis'],
      languages: ['German', 'English', 'French', 'Italian', 'Spanish', 'Latin', 'Greek', 'Hebrew']
    }
  };