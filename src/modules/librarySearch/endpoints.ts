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
      // Old lccn.loc.gov/sru is gone (404). Canonical SRU is the Z39.50-over-SRU
      // gateway on port 210. NOTE: verify from within Zotero — some networks
      // block outbound port 210 (it was unreachable from the audit sandbox).
      url: 'http://lx2.loc.gov:210/lcdb',
      defaultSchema: 'marcxml',
      description: 'Library of Congress catalog (SRU gateway, port 210)',
      version: '1.1',
      examples: {
        'title': 'bath.title=Python',
        'author': 'bath.author=Einstein',
        'isbn': 'bath.isbn=9781234567890',
        'advanced': 'bath.title=Python and bath.author=Rossum'
      }
    },
    // NOTE: Trove no longer offers open SRU. The old peopleaustralia SRW endpoint
    // is geo-blocked/defunct and was a people-search, not a book catalog. Trove v3
    // is a REST API that REQUIRES a personal API key (api.trove.nla.gov.au/v3) and
    // does not fit the SRU client. Left out until key-based support is added.
    'kb': {
      name: 'KB - National Library of the Netherlands',
      // Correct path is /sru/sru; the GGC collection must be selected via x-collection.
      url: 'http://jsru.kb.nl/sru/sru',
      defaultSchema: 'dc',
      description: 'Dutch National Library (GGC union catalogue)',
      version: '1.2',
      queryParams: { 'x-collection': 'GGC' },
      examples: {
        'title': 'dc.title=Python',
        'author': 'dc.creator=Einstein',
        'advanced': 'dc.title=Python and dc.date=2023'
      }
    },
    'bibsys': {
      name: 'BIBSYS - Norwegian Academic Libraries',
      // sru.bibsys.no was decommissioned (BIBSYS migrated to Alma). This is the
      // Alma network-zone SRU. Verified live: alma.* CQL indexes, marcxml, v1.2.
      url: 'https://bibsys-network.alma.exlibrisgroup.com/view/sru/47BIBSYS_NETWORK',
      defaultSchema: 'marcxml',
      description: 'Norwegian academic libraries (BIBSYS/Alma network zone)',
      version: '1.2',
      examples: {
        'title': 'alma.title=Python',
        'author': 'alma.creator=Einstein',
        'isbn': 'alma.isbn=9781234567890',
        'advanced': 'alma.title=Python and alma.creator=Rossum'
      }
    },
    'k10plus': {
      name: 'K10plus (GBV + SWB union catalogue)',
      // Verified live (10,996 hits). The largest German union catalogue —
      // covers most German academic libraries plus CH/AT participants. PICA indexes.
      url: 'https://sru.k10plus.de/opac-de-627',
      defaultSchema: 'marcxml',
      description: 'German union catalogue (GBV+SWB), most academic libraries',
      version: '1.1',
      examples: {
        'title': 'pica.tit=Python',
        'author': 'pica.per=Einstein',
        'isbn': 'pica.isb=9783658310844',
        'advanced': 'pica.tit=Python and pica.jhr=2023'
      }
    },
    'swisscovery': {
      name: 'swisscovery (SLSP, Swiss academic union)',
      // Verified live (6,340 hits). Swiss Library Service Platform (Alma network).
      url: 'https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK',
      defaultSchema: 'marcxml',
      description: 'Swiss academic libraries union catalogue (SLSP/Alma)',
      version: '1.2',
      examples: {
        'title': 'alma.title=Python',
        'author': 'alma.creator=Einstein',
        'isbn': 'alma.isbn=9783658310844',
        'advanced': 'alma.title=Python and alma.creator=Rossum'
      }
    }
  };
  
  export const OAI_ENDPOINTS: Record<string, OAIEndpoint> = {
    // NOTE: Crossref OAI (oai.crossref.org) is intentionally NOT listed. It only
    // serves its UNIXREF schemas (cr_unixsd/…), rejects oai_dc that this client
    // sends, and OAI-PMH is date-range harvesting — not the title/author search
    // this plugin does. Crossref is resolved by DOI instead (see identifierResolver).
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
    // NOTE: removed dead OAI endpoints (verified 2026-07-03):
    //  - dnb_digital: services.dnb.de/oai/repository_digital is 404 (the main
    //    'dnb' repository already covers digital content via subject-group sets).
    //  - loc (OAI): memory.loc.gov/cgi-bin/oai2_0 is gone; LoC discontinued OAI-PMH.
    'europeana': {
      name: 'Europeana',
      url: 'https://api.europeana.eu/oai/record',
      defaultMetadataPrefix: 'edm',
      description: 'European digital cultural heritage',
      sets: {}
    },
    'ddb': {
      name: 'Deutsche Digitale Bibliothek',
      url: 'https://oai.deutsche-digitale-bibliothek.de',
      defaultMetadataPrefix: 'oai_dc',
      description: 'German Digital Library',
      sets: {}
    },
    'harvard': {
      name: 'Harvard Library',
      url: 'https://dash.harvard.edu/oai/request',
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
      url: 'https://dbkit.bibliothek.kit.edu/oai/',
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
    },
    'ezb': {
      name: 'EZB (Elektronische Zeitschriftenbibliothek, Regensburg)',
      // Verified live. Serves oai_dc and MARC21-xml. Records are ZDB serials
      // holdings; sets follow the pattern ezb:holdings:<ISIL> for a given library.
      url: 'https://ezb-oai.ur.de/zdb/oai2.php',
      defaultMetadataPrefix: 'oai_dc',
      description: 'German electronic journals library (ZDB holdings, CC0)',
      sets: {
        'ezb:holdings:DE-355': 'Universitätsbibliothek Regensburg (DE-355)'
      }
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