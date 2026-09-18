import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Capabilities.
 *
 * There are no accounts. Holding a capability is the whole of the authorisation
 * model, which is why the tokens are 32 random bytes, why only their hashes are
 * stored, and why they travel in an Authorization header and never in a URL — a
 * link is pasted into chats, appears in screenshots, and ends up in server logs.
 */

const TOKEN_BYTES = 32;

/** Human-typeable alphabet: no O/0, I/1, or other pairs people confuse. */
const JOIN_CODE_ALPHABET = 'ACDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * A readable join code such as `BUS-7K4M9Q`.
 * Short enough to read out over the noise of a bus, long enough that guessing it
 * is pointless next to the attempt limit that guards it.
 */
export function newJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
  }
  return `BUS-${code}`;
}

/** Accept the code however a person types it: spaces, dashes, lower case. */
export function normaliseJoinCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = cleaned.startsWith('BUS') ? cleaned.slice(3) : cleaned;
  return `BUS-${body}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time comparison, so a public error cannot leak whether a hash exists. */
export function secretMatchesHash(secret: string, hash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Pull a bearer token out of the Authorization header, if it is well formed. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}
