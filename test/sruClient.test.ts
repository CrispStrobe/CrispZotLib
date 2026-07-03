// Unit tests for pure helpers in librarySearch/sruClient.ts.
// escapeQueryString is a module-level pure function; importing the module does
// not execute any Zotero-global code, so this runs offline.
import { describe, it, expect } from 'vitest';
import { escapeQueryString } from '../src/modules/librarySearch/sruClient';

describe('escapeQueryString', () => {
  it('encodes spaces as +', () => {
    expect(escapeQueryString('title python')).toBe('title+python');
  });

  it('percent-encodes parentheses and asterisks', () => {
    expect(escapeQueryString('(python*)')).toBe('%28python%2A%29');
  });

  it('percent-encodes reserved characters', () => {
    expect(escapeQueryString('a=b&c')).toBe('a%3Db%26c');
  });

  it('leaves plain ASCII words untouched', () => {
    expect(escapeQueryString('Einstein')).toBe('Einstein');
  });
});
