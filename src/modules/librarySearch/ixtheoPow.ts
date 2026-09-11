// src/modules/librarySearch/ixtheoPow.ts
//
// IxTheo gates every page behind a JavaScript proof-of-work "Verifying your
// browser" challenge. The challenge page embeds a server-issued `nonce` and a
// `TS` timestamp and finds the smallest `i` such that
//
//     SHA-256(nonce + i)  has >= DIFFICULTY_BITS leading zero bits
//
// then sets a `pow_token=<nonce>:<TS>:<i>` cookie (TTL 1800s) and reloads. A
// plain fetch with no cookie receives the challenge page instead of results, so
// every non-browser client (this plugin included) must reproduce the challenge
// and send the cookie. This replicates it with Web Crypto. (PLAN 4.2)
//
// Important properties discovered live (2026-09, issue #26):
//   - The nonce MUST be one the server just issued — a locally invented nonce is
//     rejected even with an otherwise valid solution (the server tracks issued
//     nonces). So the challenge page has to be fetched first.
//   - The difficulty is a number of leading zero BITS (was a hex "0000" prefix
//     before the scheme changed), so we read `DIFFICULTY_BITS` from the page
//     rather than assume.
//   - A `pow_token` is accepted for exactly one request unless it is sent
//     together with the session cookies the server returns with the first
//     successful response (see SearchService.ixtheoFetch, which keeps a cookie
//     jar for that reason).

export interface IxTheoChallenge {
  /** Server-issued random nonce (hex) that must be echoed in the token. */
  nonce: string;
  /** Server-issued timestamp (epoch seconds, as a string) from the page. */
  ts: string;
  /** Required number of leading zero bits in SHA-256(nonce + i). */
  difficultyBits: number;
  /** Cookie lifetime advertised by the page, in seconds. */
  ttlSeconds: number;
}

export interface IxTheoPowToken {
  /** The `pow_token` cookie value: `nonce:ts:i`. */
  token: string;
  /** Absolute expiry (ms epoch); the server keeps the cookie for `ttlSeconds`. */
  expiresMs: number;
}

const DEFAULT_DIFFICULTY_BITS = 17;
const DEFAULT_TTL_SECONDS = 1800;

/**
 * Does this HTML look like the IxTheo proof-of-work challenge page rather than a
 * real results/detail page? Used to decide whether a response needs solving.
 */
export function isIxTheoChallenge(html: string): boolean {
  return (
    /Verifying your browser/i.test(html) || /DIFFICULTY_BITS\s*=/.test(html)
  );
}

/**
 * Extract the challenge parameters from a "Verifying your browser" page.
 * Returns null when the page is not a (parseable) challenge.
 */
export function parseIxTheoChallenge(html: string): IxTheoChallenge | null {
  const nonce = html.match(/const\s+nonce\s*=\s*"([0-9a-fA-F]+)"/)?.[1];
  const ts = html.match(/const\s+TS\s*=\s*"(\d+)"/)?.[1];
  if (!nonce || !ts) return null;
  const difficultyBits = Number(
    html.match(/const\s+DIFFICULTY_BITS\s*=\s*(\d+)/)?.[1] ??
      DEFAULT_DIFFICULTY_BITS,
  );
  const ttlSeconds = Number(
    html.match(/const\s+TTL\s*=\s*"(\d+)"/)?.[1] ?? DEFAULT_TTL_SECONDS,
  );
  return { nonce, ts, difficultyBits, ttlSeconds };
}

/**
 * Count leading zero bits in a SHA-256 digest, matching the challenge page's own
 * `Math.clz32((b0<<16)|(b1<<8)|b2) - 8` computation (which only looks at the
 * first three bytes).
 */
export function leadingZeroBits(bytes: Uint8Array): number {
  const value = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  return Math.clz32(value) - 8;
}

/**
 * Solve a parsed challenge: find the smallest `i` whose SHA-256(nonce + i) has
 * the required number of leading zero bits.
 *
 * @param cryptoObj  A Web Crypto instance (SubtleCrypto).
 * @param challenge  Parsed challenge parameters (see parseIxTheoChallenge).
 * @param maxIters   Safety cap so a difficulty change can't hang forever.
 */
export async function solveIxTheoChallenge(
  cryptoObj: Crypto,
  challenge: IxTheoChallenge,
  maxIters = 50_000_000,
): Promise<IxTheoPowToken> {
  const { nonce, ts, difficultyBits, ttlSeconds } = challenge;
  const enc = new TextEncoder();

  for (let i = 0; i < maxIters; i++) {
    const digest = new Uint8Array(
      await cryptoObj.subtle.digest("SHA-256", enc.encode(`${nonce}${i}`)),
    );
    if (leadingZeroBits(digest) >= difficultyBits) {
      return {
        token: `${nonce}:${ts}:${i}`,
        expiresMs: (Number(ts) + ttlSeconds) * 1000,
      };
    }
  }

  throw new Error(
    `IxTheo proof-of-work unsolved after ${maxIters} iterations ` +
      `(difficulty ${difficultyBits} bits) — the wall may have changed again (PLAN 4.2).`,
  );
}

/**
 * Parse + solve a fetched challenge page in one step.
 */
export async function solveIxTheoPowFromHtml(
  cryptoObj: Crypto,
  challengeHtml: string,
  maxIters?: number,
): Promise<IxTheoPowToken> {
  const challenge = parseIxTheoChallenge(challengeHtml);
  if (!challenge) {
    throw new Error(
      "IxTheo challenge page contained no nonce/TS — the wall may have changed again (PLAN 4.2).",
    );
  }
  return solveIxTheoChallenge(cryptoObj, challenge, maxIters);
}
