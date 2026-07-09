import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createIntakeInviteToken, hashIntakeInviteToken, isIntakeInviteExpired } from '@/lib/intakeInviteTokens'

describe('intake client auth', () => {
  it('exposes public signup route and intake auth page', () => {
    const signup = fs.readFileSync(
      path.join(process.cwd(), 'app/api/intake/signup/route.ts'),
      'utf8',
    )
    expect(signup).toContain('createUser')
    expect(signup).toContain("role: 'client'")

    const proxy = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8')
    expect(proxy).toContain('/intake/auth')
    expect(proxy).toContain('/api/intake/signup')
  })

  it('send intake returns invite URL not generic login', () => {
    const send = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/intake/send/route.ts'),
      'utf8',
    )
    expect(send).toContain('createIntakeInviteToken')
    expect(send).toContain('/intake/auth?invite=')
    expect(send).not.toContain('/auth/login?redirectTo=/intake')
  })
})

describe('intakeInviteTokens', () => {
  it('hashes tokens and detects expiry', () => {
    const invite = createIntakeInviteToken(new Date('2026-01-01T00:00:00Z'))
    expect(invite.token.length).toBeGreaterThan(20)
    expect(hashIntakeInviteToken(invite.token)).toBe(invite.tokenHash)
    expect(isIntakeInviteExpired(invite.expiresAt, new Date('2026-01-02T00:00:00Z'))).toBe(false)
    expect(isIntakeInviteExpired(invite.expiresAt, new Date('2026-01-20T00:00:00Z'))).toBe(true)
    expect(isIntakeInviteExpired(null)).toBe(true)
  })
})
