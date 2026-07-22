import crypto from 'node:crypto'

export const MANAGE_TOKEN_TTL_DAYS = 60

export interface ManageToken {
  token: string
  tokenHash: string
  expiresAt: string
}

/** Hashed manage-link token (same pattern as lib/intakeInviteTokens.ts). */
export function createManageToken(now = new Date()): ManageToken {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(
    now.getTime() + MANAGE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  return { token, tokenHash: hashManageToken(token), expiresAt }
}

export function hashManageToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isManageTokenExpired(
  expiresAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!expiresAt) return true
  const expires = Date.parse(expiresAt)
  return !Number.isFinite(expires) || expires <= now.getTime()
}
