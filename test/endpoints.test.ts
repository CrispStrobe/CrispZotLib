// Sanity/config tests for the endpoint tables. Cheap guards that catch typos,
// duplicate keys, and malformed URLs without hitting the network.
import { describe, it, expect } from 'vitest';
import {
  SRU_ENDPOINTS,
  OAI_ENDPOINTS,
  IXTHEO_ENDPOINTS,
} from '../src/modules/librarySearch/endpoints';

describe('endpoint tables', () => {
  it('every SRU endpoint has a valid http(s) URL and a default schema', () => {
    for (const [key, ep] of Object.entries(SRU_ENDPOINTS)) {
      expect(ep.url, key).toMatch(/^https?:\/\//);
      expect(ep.defaultSchema, key).toBeTruthy();
    }
  });

  it('every OAI endpoint has a valid http(s) URL and a metadata prefix', () => {
    for (const [key, ep] of Object.entries(OAI_ENDPOINTS)) {
      expect(ep.url, key).toMatch(/^https?:\/\//);
      expect(ep.defaultMetadataPrefix, key).toBeTruthy();
    }
  });

  it('every IxTheo endpoint has url and baseUrl', () => {
    for (const [key, ep] of Object.entries(IXTHEO_ENDPOINTS)) {
      expect(ep.url, key).toMatch(/^https?:\/\//);
      expect(ep.baseUrl, key).toMatch(/^https?:\/\//);
    }
  });

  // Regression guard: Crossref OAI lives at oai.crossref.org (NOT api.crossref.org/oai,
  // which 404s) and serves UNIXREF schemas, not oai_dc.
  it('points crossref at the correct OAI host and schema', () => {
    expect(OAI_ENDPOINTS.crossref.url).toBe('https://oai.crossref.org/oai');
    expect(OAI_ENDPOINTS.crossref.defaultMetadataPrefix).toMatch(/^cr_/);
  });
});
