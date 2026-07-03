// identifierResolver.ts — Resolve bibliographic identifiers (DOI, PMID, ISBN, URL)
// to a normalized BiblioRecord. Ported from CrispLib/identifier_resolver.py.
//
// This adds the one capability the plugin previously lacked versus citer/CrispLib:
// turning a known identifier into an importable citation record. Pure fetch — no
// Zotero globals — so the detection logic is unit-testable offline.
//
// Public API:
//   detectIdentifierType(id): IdentifierType | null
//   resolveIdentifier(id, { type?, timeout? }): Promise<BiblioRecord>

import { BiblioRecord } from './models';

export type IdentifierType = 'doi' | 'pmid' | 'pmcid' | 'isbn' | 'url';

const USER_AGENT =
  'CrispZotLib-IdentifierResolver/1.0 (+https://github.com/CrispStrobe/CrispZotLib)';

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
const URL_RE = /^https?:\/\//i;

function emptyRecord(id: string): BiblioRecord {
  return {
    id,
    title: 'Untitled',
    authors: [],
    editors: [],
    translators: [],
    contributors: [],
    urls: [],
    subjects: [],
  };
}

/** fetch() with an AbortController-based timeout. */
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

/** Heuristically classify an identifier string. */
export function detectIdentifierType(identifier: string): IdentifierType | null {
  const s = (identifier || '').trim();
  if (!s) return null;
  if (URL_RE.test(s)) {
    if (s.toLowerCase().includes('doi.org/') || DOI_RE.test(s)) return 'doi';
    return 'url';
  }
  const lower = s.toLowerCase();
  if (lower.startsWith('doi:')) return 'doi';
  if (DOI_RE.test(s)) return 'doi';
  if (lower.startsWith('pmid:') || lower.startsWith('pmid ')) return 'pmid';
  if (lower.startsWith('pmc') || lower.startsWith('pmcid')) return 'pmcid';
  const digits = s.replace(/[- ]/g, '');
  if (/^(\d{9}[\dxX]|\d{13})$/.test(digits)) return 'isbn';
  if (/^\d{1,9}$/.test(s)) return 'pmid';
  return null;
}

// ── DOI (Crossref via doi.org content negotiation) ───────────────────────────

export async function resolveDoi(doi: string, timeoutMs = 15000): Promise<BiblioRecord> {
  const m = DOI_RE.exec(doi);
  const doiClean = m ? m[1] : doi.trim().replace(/^doi:/i, '').replace(/^\//, '').trim();
  const resp = await fetchWithTimeout(
    `https://doi.org/${doiClean}`,
    { Accept: 'application/vnd.citationstyles.csl+json', 'User-Agent': USER_AGENT },
    timeoutMs,
  );
  if (!resp.ok) throw new Error(`DOI lookup failed: ${resp.status} ${resp.statusText}`);
  const j: any = await resp.json();

  const rec = emptyRecord(j.DOI || doiClean);
  rec.title = Array.isArray(j.title) ? j.title[0] || 'Untitled' : j.title || 'Untitled';
  rec.authors = (j.author || [])
    .map((a: any) => `${a.family || ''}, ${a.given || ''}`.replace(/(^,\s*|,\s*$)/g, '').trim())
    .filter(Boolean);
  for (const k of ['issued', 'published-print', 'published-online', 'published']) {
    const parts = j[k]?.['date-parts'];
    if (parts?.[0]?.[0]) {
      rec.year = String(parts[0][0]);
      break;
    }
  }
  rec.publisher_name = j.publisher || undefined;
  rec.journal_title = Array.isArray(j['container-title'])
    ? j['container-title'][0]
    : j['container-title'] || undefined;
  rec.volume = j.volume ? String(j.volume) : undefined;
  rec.issue = j.issue ? String(j.issue) : undefined;
  rec.pages = j.page ? String(j.page) : undefined;
  rec.doi = j.DOI || doiClean;
  rec.isbn = Array.isArray(j.ISBN) ? j.ISBN[0] : undefined;
  rec.abstract = j.abstract || undefined;
  rec.document_type = j.type || undefined; // e.g. "journal-article" -> journalArticle
  rec.urls = [j.URL || `https://doi.org/${doiClean}`];
  rec.schema = 'csl-json';
  rec.raw_data = JSON.stringify(j);
  return rec;
}

// ── PubMed (NCBI E-utilities) ────────────────────────────────────────────────

export async function resolvePmid(pmid: string, timeoutMs = 15000): Promise<BiblioRecord> {
  const pid = pmid.replace(/\D/g, '');
  const resp = await fetchWithTimeout(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pid}&retmode=json`,
    { 'User-Agent': USER_AGENT },
    timeoutMs,
  );
  if (!resp.ok) throw new Error(`PMID lookup failed: ${resp.status} ${resp.statusText}`);
  const j: any = await resp.json();
  const result = j.result?.[pid];
  if (!result) throw new Error(`PMID ${pid} not found`);

  const rec = emptyRecord(pid);
  rec.title = result.title || 'Untitled';
  rec.authors = (result.authors || []).map((a: any) => a.name).filter(Boolean);
  rec.year = (result.pubdate || '').split(' ')[0] || undefined;
  rec.journal_title = result.fulljournalname || result.source || undefined;
  rec.volume = result.volume || undefined;
  rec.issue = result.issue || undefined;
  rec.pages = result.pages || undefined;
  rec.doi = (result.articleids || []).find((a: any) => a.idtype === 'doi')?.value || undefined;
  rec.urls = [`https://pubmed.ncbi.nlm.nih.gov/${pid}/`];
  rec.document_type = 'article-journal';
  rec.schema = 'ncbi-esummary';
  rec.raw_data = JSON.stringify(result);
  return rec;
}

// ── ISBN (Open Library) ──────────────────────────────────────────────────────

export async function resolveIsbn(isbn: string, timeoutMs = 15000): Promise<BiblioRecord> {
  const isbnClean = isbn.replace(/[- ]/g, '').toUpperCase();
  // Try Open Library first; fall back to Google Books (broader coverage, esp.
  // non-English titles that Open Library often lacks).
  const fromOpenLibrary = await resolveIsbnOpenLibrary(isbnClean, timeoutMs).catch(() => null);
  if (fromOpenLibrary) return fromOpenLibrary;
  const fromGoogle = await resolveIsbnGoogleBooks(isbnClean, timeoutMs).catch(() => null);
  if (fromGoogle) return fromGoogle;
  throw new Error(`ISBN ${isbnClean} not found in Open Library or Google Books`);
}

async function resolveIsbnOpenLibrary(isbnClean: string, timeoutMs: number): Promise<BiblioRecord> {
  const resp = await fetchWithTimeout(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbnClean}&format=json&jscmd=data`,
    { 'User-Agent': USER_AGENT },
    timeoutMs,
  );
  if (!resp.ok) throw new Error(`Open Library lookup failed: ${resp.status}`);
  const j: any = await resp.json();
  const book = j[`ISBN:${isbnClean}`];
  if (!book) throw new Error(`ISBN ${isbnClean} not in Open Library`);

  const rec = emptyRecord(isbnClean);
  rec.title = book.title || 'Untitled';
  rec.authors = (book.authors || []).map((a: any) => a.name).filter(Boolean);
  const yearMatch = /\b(\d{4})\b/.exec(book.publish_date || '');
  rec.year = yearMatch ? yearMatch[1] : undefined;
  rec.publisher_name = (book.publishers || []).map((p: any) => p.name).filter(Boolean).join(', ') || undefined;
  rec.isbn = isbnClean;
  rec.pages = book.number_of_pages ? String(book.number_of_pages) : undefined;
  rec.urls = [book.url || `https://openlibrary.org/isbn/${isbnClean}`];
  rec.document_type = 'book';
  rec.schema = 'openlibrary';
  rec.raw_data = JSON.stringify(book);
  return rec;
}

async function resolveIsbnGoogleBooks(isbnClean: string, timeoutMs: number): Promise<BiblioRecord> {
  const resp = await fetchWithTimeout(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbnClean}`,
    { 'User-Agent': USER_AGENT },
    timeoutMs,
  );
  if (!resp.ok) throw new Error(`Google Books lookup failed: ${resp.status}`);
  const j: any = await resp.json();
  const vi = j.items?.[0]?.volumeInfo;
  if (!vi) throw new Error(`ISBN ${isbnClean} not in Google Books`);

  const rec = emptyRecord(isbnClean);
  rec.title = [vi.title, vi.subtitle].filter(Boolean).join(': ') || 'Untitled';
  rec.authors = vi.authors || [];
  const yearMatch = /\b(\d{4})\b/.exec(vi.publishedDate || '');
  rec.year = yearMatch ? yearMatch[1] : undefined;
  rec.publisher_name = vi.publisher || undefined;
  rec.isbn = isbnClean;
  rec.pages = vi.pageCount ? String(vi.pageCount) : undefined;
  rec.abstract = vi.description || undefined;
  rec.subjects = vi.categories || [];
  rec.language = vi.language || undefined;
  rec.urls = [vi.canonicalVolumeLink || vi.infoLink].filter(Boolean);
  rec.document_type = 'book';
  rec.schema = 'googlebooks';
  rec.raw_data = JSON.stringify(j.items[0]);
  return rec;
}

// ── URL (Wikipedia Citoid) ───────────────────────────────────────────────────

export async function resolveUrl(url: string, timeoutMs = 15000): Promise<BiblioRecord> {
  const resp = await fetchWithTimeout(
    `https://en.wikipedia.org/api/rest_v1/data/citation/mediawiki/${encodeURIComponent(url)}`,
    { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    timeoutMs,
  );
  if (!resp.ok) throw new Error(`URL lookup failed: ${resp.status} ${resp.statusText}`);
  const arr: any = await resp.json();
  if (!arr || !arr.length) throw new Error(`Citoid returned no data for ${url}`);
  const item = arr[0];

  const rec = emptyRecord(item.url || url);
  rec.title = item.title || 'Untitled';
  rec.authors = (item.author || [])
    .map((a: any) =>
      Array.isArray(a) && a.length >= 2
        ? `${a[1]}, ${a[0]}`.replace(/(^,\s*|,\s*$)/g, '').trim()
        : typeof a === 'string'
          ? a
          : '',
    )
    .filter(Boolean);
  const yearMatch = item.date ? /\b(\d{4})\b/.exec(item.date) : null;
  rec.year = yearMatch ? yearMatch[1] : undefined;
  rec.publisher_name = item.publisher || item.websiteTitle || undefined;
  rec.journal_title = item.publicationTitle || undefined;
  rec.volume = item.volume || undefined;
  rec.issue = item.issue || undefined;
  rec.pages = item.pages || undefined;
  rec.doi = item.DOI || undefined;
  rec.isbn = Array.isArray(item.ISBN) ? item.ISBN[0] : item.ISBN || undefined;
  rec.abstract = item.abstractNote || undefined;
  rec.document_type = item.itemType || 'webpage';
  rec.urls = [item.url || url];
  rec.schema = 'citoid';
  rec.raw_data = JSON.stringify(item);
  return rec;
}

// ── Public dispatcher ────────────────────────────────────────────────────────

/**
 * Resolve any supported identifier to a normalized BiblioRecord.
 * @throws if the type cannot be detected or the lookup fails.
 */
export async function resolveIdentifier(
  identifier: string,
  opts: { type?: IdentifierType; timeoutMs?: number } = {},
): Promise<BiblioRecord> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const t = (opts.type || detectIdentifierType(identifier) || '') as IdentifierType | '';
  switch (t) {
    case 'doi':
      return resolveDoi(identifier, timeoutMs);
    case 'pmid':
    case 'pmcid':
      return resolvePmid(identifier, timeoutMs);
    case 'isbn':
      return resolveIsbn(identifier, timeoutMs);
    case 'url':
      return resolveUrl(identifier, timeoutMs);
    default:
      throw new Error(
        `Unrecognized identifier: "${identifier}". Pass type=doi|pmid|isbn|url to override detection.`,
      );
  }
}
