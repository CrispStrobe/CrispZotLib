// Unit tests for charset-aware XML decoding (PLAN 2.12).
import { describe, it, expect } from "vitest";
import { decodeXml } from "../src/modules/librarySearch/httpUtils";

// Build bytes for `<?xml ... encoding=ENC?><a>Müller</a>` where the umlaut is a
// single ISO-8859-1 byte (0xFC) — i.e. NOT valid UTF-8.
function latin1Bytes(encodingDecl: string): ArrayBuffer {
  const prolog = `<?xml version="1.0" encoding="${encodingDecl}"?><a>M`;
  const suffix = `ller</a>`;
  const out: number[] = [];
  for (const ch of prolog) out.push(ch.charCodeAt(0));
  out.push(0xfc); // ü in ISO-8859-1
  for (const ch of suffix) out.push(ch.charCodeAt(0));
  return new Uint8Array(out).buffer;
}

function utf8Bytes(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

describe("decodeXml", () => {
  it("decodes ISO-8859-1 declared in the XML prolog (no HTTP charset)", () => {
    const text = decodeXml(latin1Bytes("ISO-8859-1"));
    expect(text).toContain("Müller");
  });

  it("honors the HTTP Content-Type charset over the prolog", () => {
    const text = decodeXml(
      latin1Bytes("UTF-8"),
      "text/xml; charset=iso-8859-1",
    );
    expect(text).toContain("Müller");
  });

  it("accepts the latin1 alias", () => {
    expect(decodeXml(latin1Bytes("latin1"))).toContain("Müller");
  });

  it("decodes UTF-8 by default when nothing is declared", () => {
    const text = decodeXml(utf8Bytes("<a>Müller</a>"));
    expect(text).toContain("Müller");
  });

  it("does NOT mojibake: naive UTF-8 decode of the latin1 bytes would differ", () => {
    const naive = new TextDecoder("utf-8").decode(latin1Bytes("ISO-8859-1"));
    expect(naive).not.toContain("Müller"); // sanity: proves the decode path matters
    expect(decodeXml(latin1Bytes("ISO-8859-1"))).toContain("Müller");
  });
});
