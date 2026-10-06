import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addYears,
  composeClosingNotice,
  closingNoticeSummary,
  DEFAULT_FILE_CLOSING_SETTINGS,
  describePlan,
  formatDateKey,
  parseSettingsPatch,
  retentionReviewTask,
  retentionState,
  retentionUntil,
  selectRetentionReview,
  settingsFromRow,
  type RetentionCandidate,
} from '@/lib/fileClosing/model'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG } from '@/lib/actions/autonomy'
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_META } from '@/lib/email/categories'
import { SYSTEM_AUTOMATIONS } from '@/lib/automations/registry'
import { SETTINGS_NAV, resolveSettingsTab } from '@/app/admin/settings/settingsNav'

/**
 * File closing and retention. Closing used to be two moves that did not know
 * about each other and told the client nothing; the file had no retention
 * date and nothing ever came back to it. These pin down the retention
 * arithmetic, the closing notice, the weekly review, and that the two close
 * paths now finish the same way.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

function candidate(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    matterId: '00000000-0000-0000-0000-000000000020',
    matterName: 'Chen, Marcus & Lily',
    clientName: 'Marcus Chen',
    status: 'closed',
    stage: 'closed',
    closedOn: '2020-03-10',
    retentionUntil: '2026-03-10',
    hold: false,
    holdReason: null,
    ...overrides,
  }
}

describe('retention dates', () => {
  it('adds whole years from the closed date, Feb 29 landing on Feb 28', () => {
    expect(addYears('2026-10-06', 6)).toBe('2032-10-06')
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28')
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29')
    expect(addYears('nope', 6)).toBeNull()
    expect(retentionUntil('2026-10-06T14:00:00.000Z', DEFAULT_FILE_CLOSING_SETTINGS)).toBe('2032-10-06')
  })

  it('renders a date key without shifting it into the previous day', () => {
    expect(formatDateKey('2032-10-06')).toBe('Oct 6, 2032')
  })
})

describe('where a file stands', () => {
  it('tells open, retained, held and due apart', () => {
    expect(retentionState(candidate({ status: 'active', stage: 'funding' }), '2026-10-06')).toBe('open')
    expect(retentionState(candidate({ retentionUntil: '2032-03-10' }), '2026-10-06')).toBe('retained')
    expect(retentionState(candidate({ hold: true }), '2026-10-06')).toBe('held')
    expect(retentionState(candidate(), '2026-10-06')).toBe('due')
    // The due date itself counts as due; a file with no date is still kept.
    expect(retentionState(candidate({ retentionUntil: '2026-10-06' }), '2026-10-06')).toBe('due')
    expect(retentionState(candidate({ retentionUntil: null }), '2026-10-06')).toBe('retained')
  })

  it('counts a matter closed on either axis', () => {
    expect(retentionState(candidate({ status: 'active', stage: 'closed' }), '2026-10-06')).toBe('due')
    expect(retentionState(candidate({ status: 'archived', stage: 'funding' }), '2026-10-06')).toBe('due')
  })

  it('sorts the review list oldest first and keeps held files out of it', () => {
    const selection = selectRetentionReview([
      candidate({ matterId: 'a', retentionUntil: '2026-05-01' }),
      candidate({ matterId: 'b', retentionUntil: '2025-01-01' }),
      candidate({ matterId: 'c', retentionUntil: '2025-06-01', hold: true }),
      candidate({ matterId: 'd', retentionUntil: '2030-01-01' }),
      candidate({ matterId: 'e', status: 'active', stage: 'drafting' }),
    ], '2026-10-06')
    expect(selection.due.map(c => c.matterId)).toEqual(['b', 'a'])
    expect(selection.held.map(c => c.matterId)).toEqual(['c'])
    expect(selection.retained.map(c => c.matterId)).toEqual(['d'])
  })

  it('writes the review task so the attorney knows what to decide and where', () => {
    const task = retentionReviewTask(candidate(), DEFAULT_FILE_CLOSING_SETTINGS)
    expect(task.title).toBe('File retention review: Marcus Chen')
    expect(task.description).toContain('6-year retention period for this file ended Mar 10, 2026')
    expect(task.description).toContain('Settings → Workflow → File closing')
    expect(task.description).toContain('place it on hold')
  })
})

describe('the closing notice', () => {
  const base = {
    firstName: 'Marcus',
    firmName: 'Aubrey Law',
    attorneyShortName: 'Scott Aubrey',
    planDescription: 'your trust-based estate plan',
    hasPortalAccount: true,
    portalUrl: 'https://portal.example.com/documents',
    annualReviews: true,
    retentionYears: 6,
    retentionUntil: '2032-10-06',
  }

  it('says the work is done, what to keep safe, where the documents live, and how long the file is kept', () => {
    const email = composeClosingNotice(base)
    expect(email.subject).toBe('Your trust-based estate plan is complete')
    expect(composeClosingNotice({ ...base, planDescription: 'the estate administration' }).subject).toBe('The estate administration is complete')
    expect(email.text).toContain('Hi Marcus,')
    expect(email.text).toContain('Our work on your trust-based estate plan is complete')
    expect(email.text).toContain('Keep your signed originals somewhere safe')
    expect(email.text).toContain('Copies of your documents stay available in your portal')
    expect(email.text).toContain(base.portalUrl)
    expect(email.text).toContain('We will check in with you about a year from now')
    expect(email.text).toContain('for at least 6 years after closing, until Oct 6, 2032')
    expect(email.text).toContain('Scott Aubrey\nAubrey Law')
    expect(email.html).toContain(`<a href="${base.portalUrl}"`)
  })

  it('adapts to a client without a portal account or annual reviews', () => {
    const email = composeClosingNotice({ ...base, hasPortalAccount: false, portalUrl: null, annualReviews: false, retentionUntil: null })
    expect(email.text).toContain('Copies of your documents are in your file with us')
    expect(email.text).not.toContain('portal')
    expect(email.text).not.toContain('check in with you')
    expect(email.text).toContain('please get in touch')
    expect(email.text).toContain('for at least 6 years after closing. After that')
    expect(email.html).not.toContain('<a ')
  })

  it('describes the plan from the record', () => {
    expect(describePlan('EP', 'joint_trust')).toBe('your trust-based estate plan')
    expect(describePlan('EP', 'will_based')).toBe('your will-based estate plan')
    expect(describePlan('EP', null)).toBe('your estate plan')
    expect(describePlan('PB', null)).toBe('the estate administration')
  })

  it('escapes what the record supplies and summarises the send plainly', () => {
    expect(composeClosingNotice({ ...base, firstName: '<b>M</b>' }).html).toContain('&lt;b&gt;M&lt;/b&gt;')
    expect(closingNoticeSummary('Marcus Chen', 'm@example.com')).toBe('Send the closing notice to Marcus Chen')
    expect(closingNoticeSummary(null, 'm@example.com')).toBe('Send the closing notice to m@example.com')
  })
})

describe('settings', () => {
  it('reads the two columns with defaults where a column is missing', () => {
    expect(settingsFromRow(null)).toEqual({ retentionYears: 6, closingNoticeEnabled: true })
    expect(settingsFromRow({ file_retention_years: 7, closing_notice_enabled: false })).toEqual({ retentionYears: 7, closingNoticeEnabled: false })
  })

  it('checks a patch and explains what is wrong in a sentence', () => {
    expect(parseSettingsPatch({ retentionYears: '10', closingNoticeEnabled: false })).toEqual({ retentionYears: 10, closingNoticeEnabled: false })
    expect(() => parseSettingsPatch({ retentionYears: 0 })).toThrow('Retention years must be a whole number between 1 and 30')
    expect(() => parseSettingsPatch({ closingNoticeEnabled: 'yes' })).toThrow('closingNoticeEnabled must be true or false')
  })

  it('has a Settings tab in the Workflow group that resolves for every staff user', () => {
    const workflow = SETTINGS_NAV.find(group => group.label === 'Workflow')
    expect(workflow?.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tab', tab: 'file-closing', label: 'File closing' })]))
    expect(resolveSettingsTab('file-closing', false)).toBe('file-closing')
  })

  it('reads with any staff role and writes as an administrator', () => {
    const route = read('app/api/admin/settings/file-closing/route.ts')
    expect(route).toContain('requireAdmin(req)')
    expect(route).toContain('requireAdministrator(req)')
  })
})

describe('the send through the delegation dial', () => {
  const actor = { id: '00000000-0000-0000-0000-000000000001' }

  it('is an external write in the communications group', () => {
    expect(getActionDefinition('matter.closing.notice.send')?.risk).toBe('external_write')
    expect(ACTION_CATALOG['matter.closing.notice.send']).toMatchObject({ group: 'communications' })
  })

  it('validates the matter reference', () => {
    const definition = getActionDefinition('matter.closing.notice.send')
    expect(() => definition?.validate({ matterId: 'nope' }, actor)).toThrow('valid matter identifier')
    expect(definition?.validate({ matterId: '00000000-0000-0000-0000-000000000030', extra: 1 }, actor)).toEqual({ matterId: '00000000-0000-0000-0000-000000000030' })
  })

  it('has its own email category addressed to the client', () => {
    expect(EMAIL_CATEGORIES).toContain('matter_closing_notice')
    expect(EMAIL_CATEGORY_META.matter_closing_notice.recipient).toBe('client')
  })

  it('always creates the proposal, composes from the record at send, and posts to the portal too', () => {
    const server = read('lib/fileClosing/server.ts')
    expect(server).toContain('actionKey: CLOSING_NOTICE_ACTION_KEY')
    expect(server).toContain('applyAutonomy: true')
    expect(server).not.toContain('resolveActionAutonomy')
    expect(server).toContain("category: 'matter_closing_notice'")
    expect(server).toContain("sender_role: 'attorney'")
    expect(server).toContain("event_type: 'email_sent'")
  })
})

describe('one close on both axes', () => {
  it('finishes the same way from the Close-out card and from the status dropdown', () => {
    const stage = read('app/api/admin/matters/[id]/stage/route.ts')
    const status = read('app/api/admin/matters/[id]/status/route.ts')
    for (const source of [stage, status]) {
      expect(source).toContain("import { finishMatterClose } from '@/lib/fileClosing/server'")
      expect(source).toContain('await finishMatterClose(admin, { matterId, actor })')
    }
    // The stage route runs the status transition (and its billing check) first.
    expect(stage.indexOf("rpc('transition_matter_status_with_closeout'")).toBeLessThan(stage.indexOf("rpc('transition_matter_stage_with_jobs'"))
    expect(stage).toContain("if (statusError.code === 'P0001') return NextResponse.json({ error: statusError.message }, { status: 409 })")
  })

  it('no longer stamps the closed date from the browser', () => {
    const client = read('app/admin/matters/[id]/MatterDetailClient.tsx')
    expect(client).not.toContain("handleSaveMatterDetailField('closed_date'")
  })

  it('stamps the closed and retention dates only where they are missing', () => {
    const server = read('lib/fileClosing/server.ts')
    expect(server).toContain("if (!row?.closed_date) update.closed_date = closedOn")
    expect(server).toContain('if (!row?.retention_until && until) update.retention_until = until')
  })
})

describe('the weekly review', () => {
  it('is a system automation with a matching deployment cron', () => {
    expect(SYSTEM_AUTOMATIONS.find(entry => entry.key === 'file-retention')).toMatchObject({ path: '/api/cron/file-retention', schedules: ['40 12 * * 1'] })
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    expect(vercel.crons).toContainEqual({ path: '/api/cron/file-retention', schedule: '40 12 * * 1' })
  })

  it('proposes a task per due file, one decision per retention date, and never destroys anything', () => {
    const server = read('lib/fileClosing/server.ts')
    expect(server).toContain("actionKey: 'task.create'")
    expect(server).toContain('idempotencyKey: `retention:${candidate.matterId}:${candidate.retentionUntil}`')
    expect(server).not.toContain('deleteMatter')
    const route = read('app/api/cron/file-retention/route.ts')
    expect(route).toContain("runSystemAutomation('file-retention'")
    expect(route).toContain('CRON_SECRET')
  })

  it('ships the schema: settings, retention columns, a backfill, and the rule row', () => {
    const migration = read('supabase/migrations/20270117090000_file_closing_retention.sql')
    expect(migration).toContain('file_retention_years integer not null default 6')
    expect(migration).toContain('closing_notice_enabled boolean not null default true')
    expect(migration).toContain('add column if not exists retention_until date')
    expect(migration).toContain('add column if not exists retention_hold boolean not null default false')
    expect(migration).toContain('set retention_until = (md.closed_date + make_interval(years => coalesce(fs.file_retention_years, 6)))::date')
    expect(migration).toContain("'system:file-retention'")

    const types = read('packages/db-types/src/supabase.generated.ts')
    expect(types).toContain('file_retention_years: number')
    expect(types).toContain('retention_until: string | null')
    expect(types).toContain('retention_hold: boolean')
  })

  it('lets staff hold a file from the matter and from Settings, and destroy only through the logged delete', () => {
    expect(read('app/api/admin/matter-details/route.ts')).toContain("'retention_until', 'retention_hold', 'retention_hold_reason'")
    expect(read('app/admin/matters/[id]/tabs/billing-cards.tsx')).toContain("onSaveField('retention_hold', checked)")
    const section = read('app/admin/settings/FileClosingSettingsSection.tsx')
    expect(section).toContain("method: 'DELETE'")
    // Type-to-confirm through the app's own dialog, never the browser's.
    expect(section).toContain("requireExact: 'DESTROY'")
    expect(section).not.toMatch(/window\.(alert|confirm|prompt)\(/)
    expect(section).toContain('Retention period ended')
  })
})

describe('the signing closeout automation', () => {
  it('names the pipeline stage the job maps, so the closeout task is actually created', () => {
    const evaluate = read('lib/automations/evaluate.ts')
    expect(evaluate).toContain("summary: 'Create signing closeout work', payload: { stage: 'post_execution' }")
    expect(evaluate).not.toContain("payload: { stage: 'closeout' }")
  })
})
