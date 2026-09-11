// Unit test for the IxTheo proof-of-work solver (PLAN 4.2; scheme re-worked for
// issue #26 — see ixtheoPow.ts).
import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import {
  isIxTheoChallenge,
  leadingZeroBits,
  parseIxTheoChallenge,
  solveIxTheoChallenge,
  solveIxTheoPowFromHtml,
} from "../src/modules/librarySearch/ixtheoPow";

const crypto = webcrypto as unknown as Crypto;

const CHALLENGE_HTML = `<!doctype html>
<html><head><title>Verifying your browser</title></head>
<body>
<script>
  const DIFFICULTY_BITS = 12;
  const nonce = "abcdef0123456789abcdef0123456789";
  const TS = "1789112246";
  const TTL = "1800";
</script>
</body></html>`;

async function sha256(msg: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg)),
  );
}

describe("parseIxTheoChallenge", () => {
  it("extracts nonce, ts, difficulty and ttl", () => {
    expect(parseIxTheoChallenge(CHALLENGE_HTML)).toEqual({
      nonce: "abcdef0123456789abcdef0123456789",
      ts: "1789112246",
      difficultyBits: 12,
      ttlSeconds: 1800,
    });
  });

  it("returns null when the page is not a challenge", () => {
    expect(
      parseIxTheoChallenge("<html><body>results</body></html>"),
    ).toBeNull();
  });

  it("defaults difficulty/ttl when absent", () => {
    const c = parseIxTheoChallenge('const nonce = "ab12"; const TS = "1";');
    expect(c?.difficultyBits).toBe(17);
    expect(c?.ttlSeconds).toBe(1800);
  });
});

describe("isIxTheoChallenge", () => {
  it("detects the challenge page", () => {
    expect(isIxTheoChallenge(CHALLENGE_HTML)).toBe(true);
  });
  it("rejects a results page", () => {
    expect(
      isIxTheoChallenge(
        "<html><title>Search Results - Habermas</title></html>",
      ),
    ).toBe(false);
  });
});

describe("leadingZeroBits", () => {
  it("counts zero bits across the first three bytes", () => {
    expect(leadingZeroBits(new Uint8Array([0x80, 0, 0]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x40, 0, 0]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0, 0x80, 0]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x80]))).toBe(16);
    expect(leadingZeroBits(new Uint8Array([0, 0, 0]))).toBe(24);
  });
});

describe("solveIxTheoChallenge", () => {
  it("produces a token whose SHA-256(nonce+i) meets the difficulty", async () => {
    const challenge = parseIxTheoChallenge(CHALLENGE_HTML)!;
    const { token, expiresMs } = await solveIxTheoChallenge(crypto, challenge);
    const [nonce, ts, i] = token.split(":");
    expect(nonce).toBe(challenge.nonce);
    expect(ts).toBe(challenge.ts);
    expect(i).toMatch(/^\d+$/);
    const digest = await sha256(`${nonce}${i}`);
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(
      challenge.difficultyBits,
    );
    // ts + ttl seconds, in ms.
    expect(expiresMs).toBe((Number(challenge.ts) + 1800) * 1000);
  });

  it("throws when the difficulty is unreachable within maxIters", async () => {
    const challenge = {
      nonce: "ab",
      ts: "1",
      difficultyBits: 24,
      ttlSeconds: 1800,
    };
    await expect(solveIxTheoChallenge(crypto, challenge, 1)).rejects.toThrow(
      /unsolved/,
    );
  });
});

describe("solveIxTheoPowFromHtml", () => {
  it("parses and solves in one step", async () => {
    const { token } = await solveIxTheoPowFromHtml(crypto, CHALLENGE_HTML);
    const [nonce, , i] = token.split(":");
    expect(nonce).toBe("abcdef0123456789abcdef0123456789");
    const digest = await sha256(`${nonce}${i}`);
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(12);
  });

  it("throws when the page is not a challenge", async () => {
    await expect(
      solveIxTheoPowFromHtml(crypto, "<html>nope</html>"),
    ).rejects.toThrow(/no nonce/);
  });
});
