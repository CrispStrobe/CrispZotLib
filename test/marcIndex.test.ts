// Unit tests for indexMarcRecord — the one-pass MARCXML field index that
// replaced the per-lookup doc.evaluate scans in parseMarcXml.
// Runs offline against @xmldom/xmldom (no Zotero globals, no doc.evaluate).
import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { indexMarcRecord } from '../src/modules/librarySearch/sruClient';

const ELEMENT_NODE = 1;

// A MARCXML record inside the MARC namespace, to exercise the
// namespace-agnostic (getElementsByTagNameNS / localName) lookups.
const MARCXML = `
<marc:record xmlns:marc="http://www.loc.gov/MARC21/slim">
  <marc:leader>00000nam a2200000 a 4500</marc:leader>
  <marc:datafield tag="245" ind1="1">
    <marc:subfield code="a">Main Title</marc:subfield>
    <marc:subfield code="b">the subtitle</marc:subfield>
  </marc:datafield>
  <marc:datafield tag="100" ind1="1">
    <marc:subfield code="a">Doe, Jane</marc:subfield>
    <marc:subfield code="e">author</marc:subfield>
  </marc:datafield>
  <marc:datafield tag="700" ind1="1">
    <marc:subfield code="a">Roe, Richard</marc:subfield>
  </marc:datafield>
  <marc:datafield tag="700" ind1="2">
    <marc:subfield code="a">Second, Editor</marc:subfield>
  </marc:datafield>
  <marc:datafield tag="650">
    <marc:subfield code="a">Philosophy</marc:subfield>
  </marc:datafield>
  <marc:datafield tag="650">
    <marc:subfield code="a">Ethics</marc:subfield>
  </marc:datafield>
</marc:record>`;

function parseRecord(xml: string): Element {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return doc.documentElement as unknown as Element;
}

describe('indexMarcRecord', () => {
  const record = parseRecord(MARCXML);
  const marc = indexMarcRecord(record, ELEMENT_NODE);

  it('reads the leader text', () => {
    expect(marc.leader).toBe('00000nam a2200000 a 4500');
  });

  it('getData returns trimmed subfield text across all fields of a tag', () => {
    expect(marc.getData('245', 'a')).toEqual(['Main Title']);
    expect(marc.getData('245', 'b')).toEqual(['the subtitle']);
    expect(marc.getData('650', 'a')).toEqual(['Philosophy', 'Ethics']);
  });

  it('getData returns empty array for absent tag/code', () => {
    expect(marc.getData('999', 'a')).toEqual([]);
    expect(marc.getData('245', 'z')).toEqual([]);
  });

  it('getFields returns all datafield elements for a tag', () => {
    expect(marc.getFields('700')).toHaveLength(2);
    expect(marc.getFields('245')).toHaveLength(1);
  });

  it('getFields filters by first indicator when given', () => {
    expect(marc.getFields('700', '1')).toHaveLength(1);
    expect(marc.getFields('700', '2')).toHaveLength(1);
    expect(marc.getFields('700', '9')).toHaveLength(0);
  });

  it('getSub returns the first matching subfield element or null', () => {
    const [field100] = marc.getFields('100');
    expect(marc.getSub(field100, 'a')?.textContent).toBe('Doe, Jane');
    expect(marc.getSub(field100, 'e')?.textContent).toBe('author');
    expect(marc.getSub(field100, 'x')).toBeNull();
  });
});
