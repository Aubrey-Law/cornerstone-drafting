import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260828000000_contact_communications.sql'

describe('contact communications schema', () => {
  it('adds a contact association to both message tables', () => {
    const migration = source(MIGRATION)
    expect(migration).toMatch(/alter table public\.sms_messages\s+add column if not exists contact_id uuid references public\.contacts\(id\)/i)
  })

  it('widens thread keys so a contact thread can hold triage state', () => {
    expect(source(MIGRATION)).toMatch(/\^\(matter\|lead\|contact\):\[0-9a-f-\]\{36\}\$/)
  })

  it('widens the email draft and schedule contexts to match', () => {
    const migration = source(MIGRATION)
    for (const table of ['email_drafts', 'scheduled_emails']) {
      expect(migration).toMatch(new RegExp(`add constraint ${table}_context_type_check[\\s\\S]{0,200}'contact'`, 'i'))
    }
    // The routes have to accept it too, or the widened CHECK is unreachable.
    expect(source('app/api/admin/email/draft/route.ts')).toMatch(/'matter', 'lead', 'contact', 'general'/)
    expect(source('app/api/admin/email/scheduled/route.ts')).toMatch(/'matter', 'lead', 'contact', 'general'/)
  })

  it('attributes an inbound message to the contact it came from', () => {
    // Calls no longer link to a record, so only the SMS trigger does this.
    expect(source(MIGRATION)).toMatch(/new\.contact_id := matched_contact/i)
  })
})

describe('contact threads in the inbox', () => {
  const VIEW = 'supabase/migrations/20260829000000_contact_inbox_threads.sql'

  it('keys a message to its contact even when it inherits a matter', () => {
    // One message, one thread — keying it twice would double-count
    // unread_count and last_message_at across two inbox rows.
    const migration = source(VIEW)
    expect(migration).toMatch(/when contact_id is not null then 'contact:' \|\| contact_id/i)
    expect(migration).toMatch(/case when contact_id is null then matter_id end/i)
    expect(migration).toMatch(/case when contact_id is null then lead_id end/i)
  })

  it('drops the view rather than replacing it', () => {
    // CREATE OR REPLACE VIEW can only append columns; contact_id sits beside
    // matter_id and lead_id.
    expect(source(VIEW)).toMatch(/drop view if exists public\.v_communication_threads/i)
  })

})

describe('emails in the timeline', () => {
  const VIEW = 'supabase/migrations/20260830000000_email_log_record_links.sql'

  it('gives email_log a lead and contact link', () => {
    const migration = source(VIEW)
    expect(migration).toMatch(/add column if not exists lead_id uuid references public\.client_intake/i)
    expect(migration).toMatch(/add column if not exists contact_id uuid references public\.contacts/i)
    expect(migration).toMatch(/e\.matter_id, e\.lead_id, e\.contact_id, 'email'/)
  })

  it('threads the record ids through the send path', () => {
    // The columns are useless unless sendEmail is actually handed the ids —
    // manual composer emails previously threaded to nothing at all.
    expect(source('lib/email/send.ts')).toMatch(/matter_id: args\.matterId \?\? null/)
    expect(source('lib/email/send.ts')).toMatch(/contact_id: args\.contactId \?\? null/)
    const route = source('app/api/admin/email/send/route.ts')
    expect(route).toMatch(/matterId,\n\s*leadId,\n\s*contactId,/)
    expect(source('components/rail/RailEmailPane.tsx'))
      .toMatch(/contactId: context\?\.recordType === 'contact' \? context\.recordId : undefined/)
  })

  it('records the link on every logged outcome, not just a successful send', () => {
    // Suppressed and errored sends have to be findable too.
    const send = source('lib/email/send.ts')
    expect(send.match(/\.\.\.recordLink,/g)?.length).toBe(6)
  })

  it('degrades rather than losing the row on a database missing the columns', () => {
    expect(source('lib/email/send.ts')).toMatch(/\['bcc', 'lead_id', 'contact_id'\]/)
  })


})

describe('lead SMS replies from the inbox', () => {
  it('resolves a matter target from the unfiltered pipeline view', () => {
    // Every lead now carries an opportunity matter and the SMS trigger threads
    // lead conversations under it, but v_matter_pipeline is hired-only — so
    // replying to a lead from the inbox failed with "Matter not found".
    const outbound = source('lib/sms/outbound.ts')
    expect(outbound).toMatch(/\.from\('v_matter_pipeline_all'\)/)
    expect(outbound).not.toMatch(/\.from\('v_matter_pipeline'\)/)
  })
})

describe('contact communications routes', () => {
  const routes = [
    'app/api/admin/contacts/[id]/send-sms/route.ts',
    'app/api/admin/contacts/[id]/sms-messages/route.ts',
  ]

  it('gates every contact comms route behind requireAdmin', () => {
    for (const route of routes) {
      expect(source(route)).toMatch(/requireAdmin\(req\)/)
    }
  })

  it('retires the contact SMS route behind authorization', () => {
    const route = source('app/api/admin/contacts/[id]/send-sms/route.ts')
    expect(route).toContain('requireAdmin')
    expect(route).toContain('410')
    expect(route).not.toContain('sendOutboundSms')
  })

  it('scopes contact reads to the contact, never to its household', () => {
    // A trustee must not be shown the client's history under their own name.
    expect(source('app/api/admin/contacts/[id]/sms-messages/route.ts'))
      .toMatch(/\.eq\('contact_id', contactId\)/)
  })
})
