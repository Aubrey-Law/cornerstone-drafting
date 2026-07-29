import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { portalUrl } from '@/lib/urls'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { hashIntakeInviteToken, isIntakeInviteExpired } from '@/lib/intakeInviteTokens'

const PREFIX = 'si1'

type AdminClient = ReturnType<typeof getAdminClient>

type StandingPayload = {
  i: string
  v: string
}

export type ResolvedIntakeInvite = Record<string, unknown> & {
  id: string
  email?: string | null
  status?: string | null
  user_id?: string | null
  client_user_id?: string | null
  intake_token_expires_at?: string | null
}

function signingSecret(): string {
  const configured = process.env.INTAKE_LINK_SIGNING_SECRET?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV !== 'production') return 'cornerstone-local-standing-intake-links'
  throw new Error('INTAKE_LINK_SIGNING_SECRET is not configured')
}

function signature(encodedPayload: string): string {
  return createHmac('sha256', signingSecret())
    .update(`${PREFIX}.${encodedPayload}`, 'utf8')
    .digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseStandingToken(token: string): StandingPayload | null {
  const [prefix, encodedPayload, suppliedSignature, extra] = token.split('.')
  if (prefix !== PREFIX || !encodedPayload || !suppliedSignature || extra) return null
  if (!safeEqual(suppliedSignature, signature(encodedPayload))) return null
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<StandingPayload>
    if (typeof parsed.i !== 'string' || typeof parsed.v !== 'string') return null
    return { i: parsed.i, v: parsed.v }
  } catch {
    return null
  }
}

export function createStandingIntakeVersion(): string {
  return randomUUID()
}

export function createStandingIntakeToken(intakeId: string, version: string): string {
  const encoded = Buffer.from(JSON.stringify({ i: intakeId, v: version }), 'utf8').toString('base64url')
  return `${PREFIX}.${encoded}.${signature(encoded)}`
}

export function standingIntakeUrl(intakeId: string, version: string): string {
  const token = createStandingIntakeToken(intakeId, version)
  return portalUrl(`/intake/auth?invite=${encodeURIComponent(token)}`)
}

export async function ensureStandingIntakeLink(
  admin: AdminClient,
  intakeId: string,
  reviveRevoked = true,
): Promise<{ url: string | null; version: string; createdAt: string; revoked?: boolean }> {
  const { data: current, error: fetchError } = await admin
    .from('client_intake')
    .select('id, intake_link_version, intake_link_created_at, intake_link_revoked_at')
    .eq('id', intakeId)
    .maybeSingle()
  if (fetchError) throw new Error(fetchError.message)
  if (!current) throw new Error('Intake not found')

  if (current.intake_link_version && !current.intake_link_revoked_at) {
    return {
      url: standingIntakeUrl(intakeId, current.intake_link_version),
      version: current.intake_link_version,
      createdAt: current.intake_link_created_at ?? new Date().toISOString(),
    }
  }
  if (current.intake_link_version && current.intake_link_revoked_at && !reviveRevoked) {
    return {
      url: null,
      version: current.intake_link_version,
      createdAt: current.intake_link_created_at ?? current.intake_link_revoked_at,
      revoked: true,
    }
  }

  const version = createStandingIntakeVersion()
  const createdAt = new Date().toISOString()
  const { error } = await admin
    .from('client_intake')
    .update({
      intake_link_version: version,
      intake_link_created_at: createdAt,
      intake_link_revoked_at: null,
    })
    .eq('id', intakeId)
  if (error) throw new Error(error.message)
  return { url: standingIntakeUrl(intakeId, version), version, createdAt }
}

export async function rotateStandingIntakeLink(admin: AdminClient, intakeId: string) {
  const version = createStandingIntakeVersion()
  const createdAt = new Date().toISOString()
  const { data, error } = await admin
    .from('client_intake')
    .update({
      intake_link_version: version,
      intake_link_created_at: createdAt,
      intake_link_revoked_at: null,
    })
    .eq('id', intakeId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Intake not found')
  return { url: standingIntakeUrl(intakeId, version), version, createdAt }
}

export async function revokeStandingIntakeLink(admin: AdminClient, intakeId: string) {
  const revokedAt = new Date().toISOString()
  const { data, error } = await admin
    .from('client_intake')
    .update({ intake_link_revoked_at: revokedAt })
    .eq('id', intakeId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Intake not found')
  return { revokedAt }
}

/**
 * Resolve standing links first, then the previous hashed/expiring invite
 * format. This is the single compatibility boundary for public intake access.
 */
export async function resolveIntakeByInviteToken(
  admin: AdminClient,
  token: string,
): Promise<ResolvedIntakeInvite | null> {
  const standing = parseStandingToken(token)
  if (standing) {
    const { data } = await admin
      .from('client_intake')
      .select('*')
      .eq('id', standing.i)
      .eq('intake_link_version', standing.v)
      .is('intake_link_revoked_at', null)
      .maybeSingle()
    return data ?? null
  }

  const tokenHash = hashIntakeInviteToken(token)
  const { data: hashed } = await admin
    .from('client_intake')
    .select('*')
    .eq('intake_token_hash', tokenHash)
    .maybeSingle()
  if (hashed && !isIntakeInviteExpired(hashed.intake_token_expires_at)) return hashed

  // Retain compatibility for databases that still carry the old plaintext
  // invite column. Null expiry remains invalid.
  const { data: legacy } = await admin
    .from('client_intake')
    .select('*')
    .eq('intake_token', token)
    .maybeSingle()
  return legacy && !isIntakeInviteExpired(legacy.intake_token_expires_at) ? legacy : null
}
