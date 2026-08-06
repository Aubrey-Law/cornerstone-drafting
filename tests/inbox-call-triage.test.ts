import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('Inbox call triage consolidation', () => {
  const migration = 'supabase/migrations/20260902000001_consolidate_calls_into_inbox.sql'

  it('keeps dismissed calls as records while removing them from the unlinked queue', () => {
    const sql = source(migration)
    expect(sql).toMatch(/add column if not exists triage_dismissed_at timestamptz/i)
    expect(sql).toMatch(/contact_id is null[\s\S]*triage_dismissed_at is null/i)

    const route = source('app/api/admin/calls/[id]/route.ts')
    expect(route).toMatch(/export async function PATCH/)
    expect(route).toMatch(/triage_dismissed_at: body\.dismissed/)
    expect(route).toMatch(/\.is\('contact_id', null\)/)
  })

  it('makes channel filters represent every channel in a thread', () => {
    expect(source(migration)).toMatch(/array_agg\(distinct channel order by channel\)/i)
    const inbox = source('app/admin/inbox/InboxClient.tsx')
    expect(inbox).toMatch(/thread\.channels\?\.includes\(wanted\)/)
    expect(inbox).toMatch(/channelFilter=\{channel\}/)
  })

  it('puts missed calls and voicemails in the attention queue', () => {
    const sql = source(migration)
    expect(sql).toMatch(/c\.voicemail_url is not null/i)
    expect(sql).toMatch(/'missed', 'no-answer', 'voicemail'/i)
    expect(sql).toMatch(/max\(occurred_at\) filter \(where needs_response\)/i)
  })

  it('links calls to contacts as well as leads and matters', () => {
    expect(source('components/calls/AssignCallDialog.tsx')).toMatch(/contactId: id/)
    const assign = source('app/api/admin/calls/[id]/assign/route.ts')
    expect(assign).toMatch(/contactId: z\.string/)
    expect(assign).toMatch(/contact_id: contactId/)
  })

  it('redirects the retired Calls page into Inbox triage', () => {
    expect(source('app/admin/calls/page.tsx'))
      .toMatch(/redirect\('\/admin\/inbox\?scope=unlinked_calls'\)/)
    expect(source('app/admin/AdminLayoutClient.tsx')).not.toMatch(/href: '\/admin\/calls'/)
    expect(source('components/GlobalSearch.tsx')).not.toMatch(/href: '\/admin\/calls'/)
  })
})
