// CQL query construction (searchService.buildSruQuery): syntax characters are
// quoted/escaped; plain words keep their bare form.
import { describe, expect, it } from "vitest";
import {
  cqlBareTerm,
  cqlEscape,
  SearchService,
} from "../src/modules/librarySearch/searchService";

const build = (params: Record<string, unknown>, endpoint: string) =>
  (SearchService as any).buildSruQuery(params, endpoint) as string;

describe("CQL helpers", () => {
  it("escapes quotes and backslashes", () => {
    expect(cqlEscape('The "Best" Book')).toBe('The \\"Best\\" Book');
    expect(cqlEscape("a\\b")).toBe("a\\\\b");
  });
  it("quotes bare terms only when they contain CQL syntax", () => {
    expect(cqlBareTerm("Python")).toBe("Python");
    expect(cqlBareTerm("TCP/IP")).toBe('"TCP/IP"');
    expect(cqlBareTerm("C++ (Programming)")).toBe('"C++ (Programming)"');
  });
});

describe("buildSruQuery", () => {
  it("keeps plain DNB title words bare", () => {
    expect(build({ title: "Python" }, "dnb")).toBe("TIT=Python");
  });
  it("quotes a DNB title containing a slash", () => {
    expect(build({ title: "TCP/IP" }, "dnb")).toBe('TIT="TCP/IP"');
  });
  it("escapes quotes inside BnF's quoted form", () => {
    expect(build({ title: 'The "Best" Book' }, "bnf")).toBe(
      'bib.title any "The \\"Best\\" Book"',
    );
  });
  it("escapes the all-fields fallback", () => {
    expect(build({ allFieldsTerm: 'say "hi"' }, "loc")).toBe(
      'cql.anywhere all "say \\"hi\\""',
    );
  });
});
