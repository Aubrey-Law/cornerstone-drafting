import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mail desk follow-ups', () => {
  it('exposes Mail Desk firm settings API for enable and archive toggles', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/mail-desk/route.ts'),
      'utf8',
    )
    expect(route).toContain('email_triage_enabled')
    expect(route).toContain('email_triage_archive_non_client')
    expect(route).toContain('emailTriageEnabled')
    expect(route).toContain('archiveNonClient')
  })

  it('renders Mail Desk settings on the Email settings tab', () => {
    const section = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/MailDeskSettingsSection.tsx'),
      'utf8',
    )
    const settings = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/StaffSettingsClient.tsx'),
      'utf8',
    )
    expect(section).toContain('Archive non-client mail from Inbox')
    expect(section).toContain('Scan the mailbox')
    expect(section).toContain('Soft-automated mail is labelled Noise only')
    expect(settings).toContain('MailDeskSettingsSection')
  })

  it('autosaves attorney and follow-up notes from Mail Desk', () => {
    const client = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/email-triage/EmailTriageClient.tsx'),
      'utf8',
    )
    const patch = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email-triage/[id]/route.ts'),
      'utf8',
    )
    expect(client).toContain('Attorney note')
    expect(client).toContain('Follow-up note')
    expect(client).toContain('threadNote')
    expect(client).toContain('followUpNote')
    expect(client).toContain('Open task')
    expect(client).toContain("duration: 12_000")
    expect(patch).toContain('thread_note')
    expect(patch).toContain('follow_up_note')
    expect(patch).toContain("followUpAt === null")
  })

  it('points the switched-off empty state at Settings → Email', () => {
    const client = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/email-triage/EmailTriageClient.tsx'),
      'utf8',
    )
    expect(client).toContain('/admin/settings?tab=email')
    expect(client).toContain('Open Settings → Email')
  })
})
