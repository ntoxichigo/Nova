import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const DEV_FALLBACK_SECRET = 'nova-dev-insecure-default-key-change-me';
let warnedAboutFallbackSecret = false;

function getEncryptionKey(): Buffer {
  const configuredSecret = process.env.TOKEN_ENCRYPTION_SECRET?.trim();

  if (configuredSecret) {
    return scryptSync(configuredSecret, 'nova-salt-v1', 32);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('TOKEN_ENCRYPTION_SECRET must be set in production before storing encrypted tokens');
  }

  if (!warnedAboutFallbackSecret) {
    warnedAboutFallbackSecret = true;
    console.warn('TOKEN_ENCRYPTION_SECRET is not set. Falling back to an insecure development-only key.');
  }

  return scryptSync(DEV_FALLBACK_SECRET, 'nova-salt-v1', 32);
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Prefixes the result with "enc:" so callers can detect encrypted vs legacy plaintext.
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a token encrypted by encryptToken.
 * Passes through legacy plaintext tokens unchanged (no "enc:" prefix).
 */
export function decryptToken(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith('enc:')) return ciphertext;
  try {
    const parts = ciphertext.slice(4).split(':');
    if (parts.length !== 3) return ciphertext;
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  } catch {
    return ciphertext;
  }
}
