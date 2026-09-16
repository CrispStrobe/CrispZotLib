import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OAIClient } from "../src/modules/librarySearch/oaiClient";
import { DOMParser } from "@xmldom/xmldom";

// Wrap xmldom's DOMParser to add querySelector and querySelectorAll for tests
class TestDOMParser {
  parseFromString(str: string, type: string) {
    const doc = new DOMParser().parseFromString(str, type) as any;
    
    // Add polyfill to all Elements recursively
    function polyfillNode(node: any) {
      if (!node.querySelector) {
        node.querySelector = function(selector: string) {
          const tag = selector.split(",")[0].trim().split("|").pop()!;
          const els = this.getElementsByTagName(tag);
          if (els.length > 0) return els[0];
          const els2 = this.getElementsByTagName("oai:" + tag);
          return els2.length > 0 ? els2[0] : null;
        };
      }
      if (!node.querySelectorAll) {
        node.querySelectorAll = function(selector: string) {
          const tag = selector.split(">").pop()!.split(",")[0].trim().split("|").pop()!;
          const els = this.getElementsByTagName(tag);
          const result = [];
          for(let i=0; i<els.length; i++) {
             polyfillNode(els[i]);
             result.push(els[i]);
          }
          return result;
        };
      }
      for (let i = 0; i < node.childNodes?.length || 0; i++) {
        if (node.childNodes[i].nodeType === 1) polyfillNode(node.childNodes[i]);
      }
    }
    
    polyfillNode(doc);
    return doc;
  }
}

global.DOMParser = TestDOMParser as any;

// Mock the global ztoolkit for Node environment
(global as any).ztoolkit = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

describe("OAIClient", () => {
  let fetchStub: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchStub = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listSets works correctly", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/xml" }),
      arrayBuffer: async () => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <ListSets>
    <set>
      <setSpec>test:set</setSpec>
      <setName>Test Set</setName>
    </set>
  </ListSets>
</OAI-PMH>`).buffer
    } as any);

    const client = new OAIClient("http://test.repo/oai");
    const sets = await client.listSets();
    
    expect(sets).toBeDefined();
    expect(sets["test:set"]).toBe("Test Set");
    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringContaining("verb=ListSets"),
      expect.any(Object)
    );
  });

  it("search (ListRecords) works correctly", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/xml" }),
      arrayBuffer: async () => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <ListRecords>
    <record>
      <header><identifier>oai:test:1</identifier></header>
      <metadata><test>Record 1</test></metadata>
    </record>
  </ListRecords>
</OAI-PMH>`).buffer
    } as any);

    const client = new OAIClient("http://test.repo/oai");
    const result = await client.search("oai_dc", undefined, undefined, undefined, {}, 10);
    
    expect(result).toBeDefined();
    expect(result[1]).toHaveLength(1);
    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringContaining("verb=ListRecords"),
      expect.any(Object)
    );
  });

  it("getRecord works correctly", async () => {
    fetchStub.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/xml" }),
      arrayBuffer: async () => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <GetRecord>
    <record>
      <header><identifier>oai:test:1</identifier></header>
      <metadata><test>Data</test></metadata>
    </record>
  </GetRecord>
</OAI-PMH>`).buffer
    } as any);

    const client = new OAIClient("http://test.repo/oai");
    const record = await client.getRecord("oai:test:1");
    
    expect(record).toBeDefined();
    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringContaining("verb=GetRecord&identifier=oai%3Atest%3A1"),
      expect.any(Object)
    );
  });
});
