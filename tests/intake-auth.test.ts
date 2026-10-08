import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createIntakeInviteToken, hashIntakeInviteToken, isIntakeInviteExpired } from '@/lib/intakeInviteTokens'
import {
  createStandingIntakeToken,
  createStandingIntakeVersion,
  standingIntakeUrl,
} from '@/lib/intake/standingLinks'

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
    expect(proxy).toContain('/intake/start')
    expect(proxy).toContain('/api/intake/register')
  })

  it('send intake returns invite URL not generic login', () => {
    const send = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/intake/send/route.ts'),
      'utf8',
    )
    expect(send).toContain('ensureStandingIntakeLink')
    expect(send).toContain('intake_link: url')
    expect(send).not.toContain('/auth/login?redirectTo=/intake')
  })

  it('uses full GuidedInterview wizard (not simplified form)', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'app/intake/(shell)/page.tsx'),
      'utf8',
    )
    expect(page).toContain('GuidedInterview')
    expect(page).toContain('hydrateIntakeWithContacts')
    expect(page).toContain("intake.status === 'submitted'")
    expect(page).toContain('if (!submitted)')
    expect(page).toContain('resolveIntakeRendererMode(process.env)')
    expect(page).toContain("compileBundledIntakeForm(getIntakeTrack(intakeRow), 'client')")
    expect(page).toContain('compiledForm={compiled.form}')
    expect(page).toContain('if (!compiled.success)')
    expect(page).not.toContain('getBundledIntakeForm(')
    const wrapper = fs.readFileSync(path.join(process.cwd(), 'components/intake/GuidedInterview.tsx'), 'utf8')
    expect(wrapper).not.toContain('process.env')
    expect(wrapper).toContain('LegacyGuidedInterview')
    expect(wrapper).toContain('SchemaDrivenGuidedInterview')
    expect(fs.existsSync(path.join(process.cwd(), 'components/intake/IntakeWizard.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), 'lib/intakeSections.ts'))).toBe(true)
  })
})

describe('standing intake links', () => {
  it('creates stable signed tokens that change when their version rotates', () => {
    process.env.INTAKE_LINK_SIGNING_SECRET = 'test-standing-link-secret'
    const firstVersion = createStandingIntakeVersion()
    const secondVersion = createStandingIntakeVersion()
    const first = createStandingIntakeToken('intake-1', firstVersion)
    expect(createStandingIntakeToken('intake-1', firstVersion)).toBe(first)
    expect(createStandingIntakeToken('intake-1', secondVersion)).not.toBe(first)
    expect(first).toMatch(/^si1\./)
    expect(standingIntakeUrl('intake-1', firstVersion)).toContain('/intake/auth?invite=')
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
