import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mail desk ignore rules editor', () => {
  it('exposes list/add/delete APIs for email_triage_ignore_rules', () => {
    const list = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/mail-desk/ignore-rules/route.ts'),
      'utf8',
    )
    const byId = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/mail-desk/ignore-rules/[id]/route.ts'),
      'utf8',
    )
    expect(list).toContain("from('email_triage_ignore_rules')")
    expect(list).toContain('export async function GET')
    expect(list).toContain('export async function POST')
    expect(list).toContain("kind === 'domain'")
    expect(list).toContain('normalizeDomain')
    expect(list).toContain('normalizeAddress')
    expect(byId).toContain('export async function DELETE')
    expect(byId).toContain('.delete()')
    expect(byId).toContain('.eq(\'id\', id)')
  })

  it('renders ignored senders editor on Settings → Email', () => {
    const section = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/MailDeskIgnoreRulesSection.tsx'),
      'utf8',
    )
    const settings = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/StaffSettingsClient.tsx'),
      'utf8',
    )
    const nav = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/settingsNav.ts'),
      'utf8',
    )
    expect(section).toContain('Ignored senders')
    expect(section).toContain('/api/admin/settings/mail-desk/ignore-rules')
    expect(section).toContain('Stop ignoring this?')
    expect(section).toContain('method: \'DELETE\'')
    expect(settings).toContain('MailDeskIgnoreRulesSection')
    expect(nav).toContain('ignored senders')
  })
})
