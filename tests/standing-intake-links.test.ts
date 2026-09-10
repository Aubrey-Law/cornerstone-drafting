import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('standing intake link integration', () => {
  it('prepares links in the shared lead service without marking the intake sent', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/leads/createLead.ts'), 'utf8')
    expect(source).toContain('intake_link_version: intakeLinkVersion')
    expect(source).toContain('intake_link_created_at: intakeLinkCreatedAt')
    expect(source).toContain('intakeUrl: standingIntakeUrl')
    expect(source).not.toContain('intake_sent_at:')
  })

  it('keeps prepare, send, rotate, and revoke as separate staff actions', () => {
    const linkRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/intake/link/route.ts'), 'utf8')
    const sendRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/intake/send/route.ts'), 'utf8')
    expect(linkRoute).toContain('export async function GET')
    expect(linkRoute).toContain('export async function POST')
    expect(linkRoute).toContain('export async function DELETE')
    expect(linkRoute).toContain('intake_link_rotated')
    expect(linkRoute).toContain('intake_link_revoked')
    expect(sendRoute).toContain('intake_sent_at: now')
    expect(sendRoute).not.toContain('intake_token_hash:')
  })

  it('provides public onboarding with Turnstile and rate limiting', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/intake/register/route.ts'), 'utf8')
    const page = fs.readFileSync(path.join(process.cwd(), 'app/intake/start/page.tsx'), 'utf8')
    expect(route).toContain('TURNSTILE_SECRET_KEY')
    expect(route).toContain('public_intake_ip')
    expect(route).toContain('public_intake_email')
    expect(route).toContain('createLead')
    expect(route).toContain('existingAccountResponse')
    expect(page).toContain('TURNSTILE_SITE_KEY')
  })

  it('makes intake templates and link actions available from lead detail', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/leads/[id]/LeadDetailClient.tsx'), 'utf8')
    const card = fs.readFileSync(path.join(process.cwd(), 'app/admin/leads/[id]/LeadIntakeCard.tsx'), 'utf8')
    // The lead-only dialog became the shared CommunicationDialog, so the
    // intake-invite templates and link variable now live at the call site.
    // Both tracks' invitations are offered — the estate one and the
    // parent-facing College Prep one.
    expect(detail).toContain("'manual', 'intake_invite', 'intake_invite_college_prep'")
    expect(detail).toContain('intake_link: intakeUrl')
    expect(card).toContain('Email link')
    expect(card).not.toContain('Text link')
    expect(detail).toContain('rotateIntakeUrl')
    expect(detail).toContain('revokeIntakeUrl')
  })
})
