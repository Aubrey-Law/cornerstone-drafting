import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(process.cwd(), relativePath))
}

describe('calls are not linked to records', () => {
  const MIGRATION = 'supabase/migrations/20260905000000_drop_call_record_links.sql'

  it('drops the record columns and everything defined over them', () => {
    const sql = source(MIGRATION)
    expect(sql).toMatch(/drop column if exists matter_id/i)
    expect(sql).toMatch(/drop column if exists lead_id/i)
    expect(sql).toMatch(/drop column if exists contact_id/i)
    expect(sql).toMatch(/drop constraint if exists calls_single_record_link/i)
    for (const index of ['calls_unassigned_idx', 'calls_matter_id_idx', 'calls_lead_id_idx', 'calls_contact_id_idx']) {
      expect(sql).toMatch(new RegExp(`drop index if exists public\\.${index}`, 'i'))
    }
  })

  it('keeps the trigger normalizing participant_digits and nothing else', () => {
    // The softphone matches a wrap-up to its webhook row by these digits.
    const fn = source(MIGRATION).split('DROP VIEW')[0]
    expect(fn).toMatch(/NEW\.participant_digits := public\.normalize_us_phone\(NEW\.participant_number\)/)
    expect(fn).not.toMatch(/matched_matter|matched_lead|matched_contact/)
  })

  it('rebuilds the thread view without the calls branch', () => {
    const sql = source(MIGRATION)
    expect(sql).toMatch(/drop view if exists public\.v_communication_threads/i)
    // Recreated for portal, sms and email only.
    const view = sql.slice(sql.indexOf('CREATE VIEW public.v_communication_threads'))
    expect(view).toMatch(/FROM public\.messages m/)
    expect(view).toMatch(/FROM public\.sms_messages s/)
    expect(view).toMatch(/FROM public\.email_log e/)
    expect(view).not.toMatch(/FROM public\.calls/)
  })

  it('narrows upsert_retell_call so it no longer returns record ids', () => {
    const sql = source(MIGRATION)
    expect(sql).toMatch(/drop function if exists public\.upsert_retell_call\(jsonb\)/i)
    expect(sql).toMatch(/RETURNS TABLE \(previous_summary text, conflict boolean\)/)
  })
})

describe('no call surface remains in the app', () => {
  it('removed the triage queue, the record call routes and the call components', () => {
    for (const gone of [
      'app/api/admin/calls',
      'app/api/admin/matters/[id]/calls/route.ts',
      'app/api/admin/leads/[id]/calls/route.ts',
      'app/api/admin/contacts/[id]/calls/route.ts',
      'components/calls',
      'app/admin/calls',
    ]) {
      expect(exists(gone), `${gone} should be deleted`).toBe(false)
    }
  })

  it('drops the unlinked-call scope and the calls channel from the inbox', () => {
    const inbox = source('app/admin/inbox/InboxClient.tsx')
    expect(inbox).not.toMatch(/unlinked_calls/)
    expect(inbox).not.toMatch(/'calls'/)
    expect(source('app/admin/inbox/page.tsx')).not.toMatch(/fetchUnlinkedInboxCalls/)
  })

  it('stops counting unlinked calls anywhere', () => {
    for (const file of ['lib/queries/inbox.ts', 'lib/queries/sidebarCounts.ts', 'lib/queries/today.ts']) {
      expect(source(file)).not.toMatch(/from\('calls'\)/)
    }
    expect(source('lib/sidebarBadges.ts')).not.toMatch(/unassignedCallsCount/)
  })

  it('keeps call out of the timeline channel union', () => {
    expect(source('lib/comms/thread.ts')).toMatch(/export type CommChannel = 'portal' \| 'sms' \| 'email'/)
    expect(source('lib/matterPageTabs.ts'))
      .toMatch(/COMMUNICATION_CHANNELS = \['all', 'portal', 'sms', 'email'\]/)
  })

  it('logs a softphone wrap-up without attaching it to a record', () => {
    // The call-summary route still takes a record for AI drafting context —
    // that is context for the follow-up note, not a link on the call row.
    const route = source('app/api/admin/phone/call-log/route.ts')
    expect(route).not.toMatch(/matterId|leadId/)
    const softphone = source('components/softphone/Softphone.tsx')
    const callLogPost = softphone.slice(softphone.indexOf("'/api/admin/phone/call-log'"))
    expect(callLogPost.slice(0, 600)).not.toMatch(/matterId|leadId/)
  })

  it('stops deleting calls when a matter is deleted', () => {
    // Calls no longer belong to the matter, so a matter delete must leave them.
    expect(source('lib/matters/deleteMatter.ts')).not.toMatch(/from\('calls'\)/)
  })
})
