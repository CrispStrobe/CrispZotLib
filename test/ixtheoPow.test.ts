// Unit test for the IxTheo proof-of-work solver (PLAN 4.2).
import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { solveIxTheoPow } from "../src/modules/librarySearch/ixtheoPow";

const crypto = webcrypto as unknown as Crypto;

async function sha256hex(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(msg),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("solveIxTheoPow", () => {
  it("produces a token whose SHA-256(nonce+ts+i) meets the difficulty", async () => {
    const nowMs = 1_783_000_000_000; // fixed (Date.now() unavailable determinism)
    const { token, expiresMs } = await solveIxTheoPow(crypto, nowMs, "00");
    const [nonce, ts, i] = token.split(":");
    const hex = await sha256hex(`${nonce}${ts}${i}`);
    expect(hex.startsWith("00")).toBe(true);
    // ts is floor(nowMs/1000); expiry is +1800s.
    expect(Number(ts)).toBe(Math.floor(nowMs / 1000));
    expect(expiresMs).toBe((Math.floor(nowMs / 1000) + 1800) * 1000);
  });

  it("handles a multi-nibble difficulty prefix", async () => {
    const { token } = await solveIxTheoPow(crypto, 1_783_000_000_000, "000");
    const [nonce, ts, i] = token.split(":");
    expect((await sha256hex(`${nonce}${ts}${i}`)).startsWith("000")).toBe(true);
  });
});
