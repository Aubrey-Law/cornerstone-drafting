import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

interface ApprovalClaims {
  agreementId: string
  revisionId: string
  sha256: string
  exp: number
  nonce: string
}

interface ApprovalIdentity {
  agreementId: string
  revisionId: string
  sha256: string
}

function secret(): string {
  const value = process.env.ENGAGEMENT_APPROVAL_SECRET?.trim()
  if (!value) throw new Error('ENGAGEMENT_APPROVAL_SECRET is not configured')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function issueRevisionApproval(input: ApprovalIdentity & {
  expiresInSeconds: number
  now?: Date
  nonce?: string
}): string {
  if (!Number.isFinite(input.expiresInSeconds) || input.expiresInSeconds <= 0) {
    throw new Error('Approval expiry must be positive')
  }
  const claims: ApprovalClaims = {
    agreementId: input.agreementId,
    revisionId: input.revisionId,
    sha256: input.sha256,
    exp: Math.floor((input.now ?? new Date()).getTime() / 1000) + input.expiresInSeconds,
    nonce: input.nonce ?? randomBytes(18).toString('base64url'),
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyRevisionApproval(
  token: string,
  expected: ApprovalIdentity & { now?: Date },
): { ok: true; claims: ApprovalClaims } | { ok: false; error: string } {
  const [payload, suppliedSignature, extra] = token.split('.')
  if (!payload || !suppliedSignature || extra) return { ok: false, error: 'invalid approval token' }
  const expectedSignature = sign(payload)
  const supplied = Buffer.from(suppliedSignature)
  const calculated = Buffer.from(expectedSignature)
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
    return { ok: false, error: 'invalid approval signature' }
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ApprovalClaims
    if (
      claims.agreementId !== expected.agreementId
      || claims.revisionId !== expected.revisionId
      || claims.sha256 !== expected.sha256
      || !claims.nonce
    ) return { ok: false, error: 'approval does not match revision' }
    const now = Math.floor((expected.now ?? new Date()).getTime() / 1000)
    if (!Number.isFinite(claims.exp) || claims.exp <= now) return { ok: false, error: 'approval expired' }
    return { ok: true, claims }
  } catch {
    return { ok: false, error: 'invalid approval payload' }
  }
}
