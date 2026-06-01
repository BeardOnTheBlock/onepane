// ============================================================================
// Token-at-rest encryption (AES-256-GCM).
// OAuth access/refresh tokens are encrypted with a key from ONEPANE_ENCRYPTION_KEY
// before being written to the local SQLite database, so a leaked .db file does
// not expose usable credentials.
// ============================================================================

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ONEPANE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing ONEPANE_ENCRYPTION_KEY. Generate one with `openssl rand -base64 32` " +
        "and add it to your .env file.",
    );
  }
  // Accept any sufficiently-long secret; derive a stable 32-byte key from it
  // via SHA-256 so base64/hex/passphrase inputs all work.
  cachedKey = createHash("sha256").update(raw, "utf8").digest();
  return cachedKey;
}

/**
 * Encrypts a UTF-8 string. Output format is `iv:authTag:ciphertext`, each part
 * base64-encoded. Returns "" for empty input.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Reverses {@link encrypt}. Returns "" for empty input. Throws if tampered. */
export function decrypt(payload: string): string {
  if (!payload) return "";
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted payload.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
