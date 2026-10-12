import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mail desk phase C', () => {
  it('exposes attachment metadata on the live message route', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email-triage/[id]/message/route.ts'),
      'utf8',
    )
    const gmail = fs.readFileSync(
      path.join(process.cwd(), 'lib/email/gmailRead.ts'),
      'utf8',
    )
    expect(gmail).toContain('extractAttachments')
    expect(gmail).toContain('attachments: extractAttachments(raw.payload)')
    expect(route).toContain('attachments: message.attachments')
  })

  it('creates a lead from a possible_lead triage row via the shared createLead path', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email-triage/[id]/create-lead/route.ts'),
      'utf8',
    )
    expect(route).toContain("from '@/lib/leads/createLead'")
    expect(route).toContain("classification !== 'possible_lead'")
    expect(route).toContain("classification: 'lead'")
    expect(route).toContain('client_intake_id: lead.leadId')
  })

  it('supports claim/release and a Mine queue view', () => {
    const patch = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email-triage/[id]/route.ts'),
      'utf8',
    )
    const queries = fs.readFileSync(
      path.join(process.cwd(), 'lib/queries/emailTriage.ts'),
      'utf8',
    )
    const client = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/email-triage/EmailTriageClient.tsx'),
      'utf8',
    )
    expect(patch).toContain('claimedBy === true')
    expect(patch).toContain('claimed_by')
    expect(queries).toContain("| 'mine'")
    expect(queries).toContain("view === 'mine'")
    expect(client).toContain("id: 'mine'")
    expect(client).toContain('Claim')
    expect(client).toContain('Release claim')
    expect(client).toContain('Create lead')
    expect(client).toContain('datetime-local')
    expect(client).toContain('fromDatetimeLocalValue')
  })
})
