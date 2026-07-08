/**
 * AES-256-GCM helpers for staff secrets (API keys, MCP auth blobs).
 * Key material derived from USER_API_KEYS_ENCRYPTION_SECRET via scrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const SCRYPT_SALT = 'cornerstone-user-secrets-v1'
const ALGO = 'aes-256-gcm'

export interface SealedBlob {
  ciphertext: string
  iv: string
  authTag: string
}

function encryptionKey(): Buffer {
  const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET?.trim()
  if (!secret) {
    throw new Error('USER_API_KEYS_ENCRYPTION_SECRET is not configured')
  }
  return scryptSync(secret, SCRYPT_SALT, 32)
}

export function isSecretBoxConfigured(): boolean {
  return Boolean(process.env.USER_API_KEYS_ENCRYPTION_SECRET?.trim())
}

export function sealSecret(plaintext: string): SealedBlob {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function openSecret(blob: SealedBlob): string | null {
  try {
    const decipher = createDecipheriv(ALGO, encryptionKey(), Buffer.from(blob.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, 'base64')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch (err) {
    console.error('[secretBox] decrypt failed', err instanceof Error ? err.message : err)
    return null
  }
}

/** Mask a key for list responses: keep last 4 chars when long enough. */
export function maskSecretHint(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '••••••••'
  return `••••${trimmed.slice(-4)}`
}
