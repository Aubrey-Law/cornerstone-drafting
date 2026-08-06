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
    expect(migration).toMatch(/alter table public\.calls\s+add column if not exists contact_id uuid references public\.contacts\(id\)/i)
  })

  it('leaves the calls matter/lead exclusivity constraint alone', () => {
    // contact_id is orthogonal to that either/or — a contact inherits a matter.
    expect(source(MIGRATION)).not.toMatch(/drop constraint if exists calls_single_record_link/i)
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
    const migration = source(MIGRATION)
    expect(migration).toMatch(/new\.contact_id := matched_contact/i)
    // Both triggers, not just the SMS one.
    expect(migration.match(/new\.contact_id := matched_contact/gi)?.length).toBe(2)
  })

  it('revives the dead lead branch in calls_autoassign', () => {
    // The old branch required `ci.matter_id IS NULL`, which the leads/matters
    // unification made permanently false, so lead calls landed on the
    // opportunity matter and lead call history rendered empty.
    const migration = source(MIGRATION)
    expect(migration).toMatch(/coalesce\(m\.relationship_status, 'hired'\) <> 'hired'/i)
    expect(migration).toMatch(/coalesce\(m\.relationship_status, 'hired'\) = 'hired'/i)
    expect(migration).not.toMatch(/where ci\.matter_id is null/i)
  })

  it('reads lead calls from the matter too, for history recorded before the fix', () => {
    expect(source('app/api/admin/leads/[id]/calls/route.ts'))
      .toMatch(/lead_id\.eq\.\$\{leadId\},matter_id\.eq\.\$\{lead\.matter_id\}/)
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

  it('keeps contact threads out of the needs-reply badge', () => {
    // That badge measures client responsiveness; a chatty vendor must not
    // drive it. Contact threads still appear in the inbox list.
    expect(source('lib/queries/inbox.ts')).toMatch(/\.neq\('record_type', 'contact'\)/)
  })

  it('replies to a contact thread through the contact route', () => {
    expect(source('app/admin/inbox/InboxClient.tsx'))
      .toMatch(/\/api\/admin\/contacts\/\$\{selected\.contact_id\}/)
  })

  it('marks a contact thread read on its own messages', () => {
    expect(source('app/api/admin/inbox/threads/[key]/route.ts'))
      .toMatch(/key\.recordType === 'contact' \? 'contact_id' : 'lead_id'/)
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

  it('reads emails into lead and contact timelines', () => {
    expect(source('lib/queries/inbox.ts')).toMatch(/emailRows\(emails\.data \?\? \[\]\)/)
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
    'app/api/admin/contacts/[id]/calls/route.ts',
  ]

  it('gates every contact comms route behind requireAdmin', () => {
    for (const route of routes) {
      expect(source(route)).toMatch(/requireAdmin\(req\)/)
    }
  })

  it('refuses to send when no SMS provider is configured', () => {
    const route = source('app/api/admin/contacts/[id]/send-sms/route.ts')
    expect(route).toMatch(/isSmsConfigured\(\)/)
    expect(route).toMatch(/status: 503/)
  })

  it('scopes contact reads to the contact, never to its household', () => {
    // A trustee must not be shown the client's history under their own name.
    expect(source('app/api/admin/contacts/[id]/sms-messages/route.ts'))
      .toMatch(/\.eq\('contact_id', contactId\)/)
    expect(source('app/api/admin/contacts/[id]/calls/route.ts'))
      .toMatch(/\.eq\('contact_id', contactId\)/)
  })
})
