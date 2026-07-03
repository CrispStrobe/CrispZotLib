// Unit tests for pure helpers in librarySearch/sruClient.ts.
// escapeQueryString is a module-level pure function; importing the module does
// not execute any Zotero-global code, so this runs offline.
import { describe, it, expect } from 'vitest';
import { escapeQueryString, cleanPersonName } from '../src/modules/librarySearch/sruClient';

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

describe('cleanPersonName', () => {
  it('strips BnF life-dates and role phrases', () => {
    expect(cleanPersonName('Habermas, Jürgen (1929-2026). Auteur du texte')).toBe(
      'Habermas, Jürgen',
    );
    expect(cleanPersonName('Kant, Immanuel (1724-1804). Éditeur scientifique')).toBe(
      'Kant, Immanuel',
    );
  });

  it('strips open-ended and trailing dates', () => {
    expect(cleanPersonName('Rossum, Guido van (1956-)')).toBe('Rossum, Guido van');
    expect(cleanPersonName('Einstein, Albert 1879-1955')).toBe('Einstein, Albert');
  });

  it('leaves clean names untouched', () => {
    expect(cleanPersonName('Guido van Rossum')).toBe('Guido van Rossum');
    expect(cleanPersonName('Deutsche Nationalbibliothek')).toBe('Deutsche Nationalbibliothek');
  });
});
