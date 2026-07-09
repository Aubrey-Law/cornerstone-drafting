import crypto from 'node:crypto'

export const INTAKE_INVITE_TTL_DAYS = 14

export interface IntakeInviteToken {
  token: string
  tokenHash: string
  expiresAt: string
}

export function createIntakeInviteToken(now = new Date()): IntakeInviteToken {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + INTAKE_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  return {
    token,
    tokenHash: hashIntakeInviteToken(token),
    expiresAt,
  }
}

export function hashIntakeInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isIntakeInviteExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return true
  const expires = Date.parse(expiresAt)
  return !Number.isFinite(expires) || expires <= now.getTime()
}
