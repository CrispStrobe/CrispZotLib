// src/modules/librarySearch/ixtheoPow.ts
//
// IxTheo now gates every page behind a JavaScript proof-of-work "Verifying your
// browser" challenge: the page computes SHA-256(nonce + ts + i) for increasing
// i until the hex digest starts with a difficulty prefix ("0000"), then sets a
// `pow_token=nonce:ts:i` cookie (valid 30 min) and reloads. A plain fetch with
// no cookie receives the challenge page instead of results, so every non-browser
// client (this plugin included) must solve the same challenge and send the
// cookie. This replicates it with Web Crypto. (PLAN 4.2)

export interface IxTheoPowToken {
  /** The `pow_token` cookie value: `nonce:ts:i`. */
  token: string;
  /** Absolute expiry (ms epoch); the server keeps the cookie for 30 min. */
  expiresMs: number;
}

/**
 * Solve the IxTheo proof-of-work challenge.
 *
 * @param cryptoObj  A Web Crypto instance (SubtleCrypto + randomUUID).
 * @param nowMs      Current time in ms (Date.now()).
 * @param difficulty Hex prefix the digest must start with (IxTheo uses "0000").
 * @param maxIters   Safety cap so a difficulty change can't hang forever.
 */
export async function solveIxTheoPow(
  cryptoObj: Crypto,
  nowMs: number,
  difficulty = "0000",
  maxIters = 20_000_000,
): Promise<IxTheoPowToken> {
  const nonce = cryptoObj.randomUUID();
  const ts = Math.floor(nowMs / 1000);
  const enc = new TextEncoder();
  const nBytes = Math.ceil(difficulty.length / 2);

  let i = 0;
  for (; i < maxIters; i++) {
    const buf = await cryptoObj.subtle.digest(
      "SHA-256",
      enc.encode(`${nonce}${ts}${i}`),
    );
    const bytes = new Uint8Array(buf, 0, nBytes);
    let hex = "";
    for (let z = 0; z < nBytes; z++)
      hex += bytes[z].toString(16).padStart(2, "0");
    if (hex.startsWith(difficulty)) break;
  }

  // Cookie is `max-age=1800`; refresh a bit early to avoid racing expiry.
  return { token: `${nonce}:${ts}:${i}`, expiresMs: (ts + 1800) * 1000 };
}
