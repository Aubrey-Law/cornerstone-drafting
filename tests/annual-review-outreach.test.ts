import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addMonths,
  composeReviewEmail,
  decideOutreach,
  DEFAULT_ANNUAL_REVIEW_SETTINGS,
  formatDateKey,
  nextReviewDueOn,
  outreachSummary,
  parseSettingsPatch,
  selectOutreach,
  settingsFromRow,
  type AnnualReviewCandidate,
} from '@/lib/annualReview/model'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG } from '@/lib/actions/autonomy'
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_META } from '@/lib/email/categories'
import { SYSTEM_AUTOMATIONS } from '@/lib/automations/registry'
import { SETTINGS_NAV, resolveSettingsTab } from '@/app/admin/settings/settingsNav'

/**
 * Annual review outreach. A signed plan goes stale as life changes; a year
 * after signing the client should hear from the firm. These pin down who is
 * asked and when, what the email says, and that the send goes through the
 * delegation dial like every other unattended message that leaves the firm.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const settings = { ...DEFAULT_ANNUAL_REVIEW_SETTINGS, enabled: true }

function candidate(overrides: Partial<AnnualReviewCandidate> = {}): AnnualReviewCandidate {
  return {
    matterId: '00000000-0000-0000-0000-000000000020',
    matterName: 'Chen, Marcus & Lily',
    clientName: 'Marcus Chen',
    clientFirstName: 'Marcus',
    clientEmail: 'marcus@example.com',
    anchorOn: '2026-01-15',
    stage: 'closed',
    status: 'closed',
    practiceArea: 'EP',
    optedOut: false,
    lastCycleDueOn: null,
    hasPortalAccount: true,
    ...overrides,
  }
}

describe('month arithmetic on date keys', () => {
  it('adds whole months and clamps the day to the target month', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonths('not a date', 1)).toBeNull()
  })

  it('renders a key without shifting it into the previous day', () => {
    expect(formatDateKey('2027-01-15')).toBe('Jan 15, 2027')
    expect(formatDateKey('garbage')).toBe('garbage')
  })
})

describe('which review is due', () => {
  it('puts the first review the configured months after signing', () => {
    expect(nextReviewDueOn({ anchorOn: '2026-01-15', lastCycleDueOn: null }, settings, '2026-12-20')).toBe('2027-01-15')
  })

  it('steps by the cadence after a cycle has been drafted', () => {
    expect(nextReviewDueOn({ anchorOn: '2026-01-15', lastCycleDueOn: '2027-01-15' }, settings, '2027-12-20')).toBe('2028-01-15')
    expect(nextReviewDueOn({ anchorOn: '2026-01-15', lastCycleDueOn: '2027-01-15' }, { ...settings, cadenceMonths: 6 }, '2027-06-20')).toBe('2027-07-15')
  })

  it('catches a plan signed years ago up to its next review, never the ones missed', () => {
    // Signed 2020; today is late 2026. The next review is March 2027, not 2021's,
    // and not the one nine months stale.
    expect(nextReviewDueOn({ anchorOn: '2020-03-10', lastCycleDueOn: null }, settings, '2026-12-01')).toBe('2027-03-10')
    // An anniversary that passed within the grace window is still asked for.
    expect(nextReviewDueOn({ anchorOn: '2020-03-10', lastCycleDueOn: null }, settings, '2026-04-01')).toBe('2026-03-10')
    expect(nextReviewDueOn({ anchorOn: '2020-03-10', lastCycleDueOn: null }, settings, '2026-06-15')).toBe('2027-03-10')
  })
})

describe('deciding whether to ask today', () => {
  it('asks inside the notice window and not before', () => {
    expect(decideOutreach(candidate(), settings, '2027-01-01')).toEqual({ due: true, dueOn: '2027-01-15', yearsSinceSigning: 1 })
    expect(decideOutreach(candidate(), settings, '2026-12-20')).toEqual({ due: false, reason: 'not_due', dueOn: '2027-01-15' })
    // On the due date itself, and a few days past, still asks.
    expect(decideOutreach(candidate(), settings, '2027-01-20').due).toBe(true)
  })

  it('counts the years from signing for the second and later reviews', () => {
    const decision = decideOutreach(candidate({ lastCycleDueOn: '2027-01-15' }), settings, '2028-01-05')
    expect(decision).toEqual({ due: true, dueOn: '2028-01-15', yearsSinceSigning: 2 })
  })

  it('leaves out the archived, the opted out, the unsigned, and the unreachable', () => {
    expect(decideOutreach(candidate({ status: 'archived' }), settings, '2027-01-10').due).toBe(false)
    expect(decideOutreach(candidate({ optedOut: true }), settings, '2027-01-10')).toMatchObject({ reason: 'opted_out' })
    expect(decideOutreach(candidate({ stage: 'drafting', status: 'active' }), settings, '2027-01-10')).toMatchObject({ reason: 'not_signed' })
    expect(decideOutreach(candidate({ anchorOn: null }), settings, '2027-01-10')).toMatchObject({ reason: 'no_anchor' })
    expect(decideOutreach(candidate({ clientEmail: '  ' }), settings, '2027-01-10')).toMatchObject({ reason: 'no_email' })
    expect(decideOutreach(candidate({ practiceArea: 'PB' }), settings, '2027-01-10')).toMatchObject({ reason: 'not_estate_planning' })
  })

  it('treats a signed plan still in funding or post-execution as reviewable', () => {
    expect(decideOutreach(candidate({ stage: 'funding', status: 'active' }), settings, '2027-01-10').due).toBe(true)
    expect(decideOutreach(candidate({ stage: 'post_execution', status: 'active' }), settings, '2027-01-10').due).toBe(true)
  })

  it('splits a list into the due and the skipped with reasons', () => {
    const selection = selectOutreach([
      candidate(),
      candidate({ matterId: 'b', optedOut: true }),
      candidate({ matterId: 'c', anchorOn: '2026-06-01' }),
    ], settings, '2027-01-10')
    expect(selection.due.map(entry => entry.candidate.matterId)).toEqual(['00000000-0000-0000-0000-000000000020'])
    expect(selection.skipped).toEqual([
      { matterId: 'b', reason: 'opted_out' },
      { matterId: 'c', reason: 'not_due' },
    ])
  })
})

describe('the invitation', () => {
  const base = {
    firstName: 'Marcus',
    firmName: 'Aubrey Law',
    attorneyShortName: 'Scott Aubrey',
    yearsSinceSigning: 1,
    bookingUrl: 'https://portal.example.com/book/client-call',
    bookingLabel: 'Client Call',
    portalUrl: 'https://portal.example.com/documents',
  }

  it('greets by first name, names the life changes, and asks once', () => {
    const email = composeReviewEmail(base)
    expect(email.subject).toBe('Your estate plan is a year old. Time for a quick review?')
    expect(email.text).toContain('Hi Marcus,')
    expect(email.text).toContain('about a year since you signed your estate plan with Aubrey Law')
    expect(email.text).toContain('a marriage, divorce or new partner')
    expect(email.text).toContain('a child who has turned 18')
    expect(email.text).toContain(base.bookingUrl)
    expect(email.text).toContain('a one-line reply saying so is all we need')
    expect(email.text).toContain('Your signed documents are always in your portal')
    expect(email.text).toContain('Scott Aubrey\nAubrey Law')
    expect(email.html).toContain(`<a href="${base.bookingUrl}"`)
    expect(email.html).toContain('<li>a move, or a new home or other real estate</li>')
  })

  it('asks for a reply when there is no booking page, and skips the portal line without an account', () => {
    const email = composeReviewEmail({ ...base, bookingUrl: null, bookingLabel: null, portalUrl: null })
    expect(email.text).toContain('Reply to this email and we will find a time.')
    expect(email.text).not.toContain('portal')
    expect(email.html).not.toContain('<a ')
  })

  it('counts the years on later reviews and greets without a name when none is known', () => {
    const email = composeReviewEmail({ ...base, firstName: null, yearsSinceSigning: 3 })
    expect(email.subject).toBe('Time for a quick review of your estate plan')
    expect(email.text).toContain('Hello,')
    expect(email.text).toContain('about 3 years since you signed')
  })

  it('escapes what the record supplies', () => {
    const email = composeReviewEmail({ ...base, firstName: '<b>Marcus</b>' })
    expect(email.html).not.toContain('<b>Marcus</b>')
    expect(email.html).toContain('&lt;b&gt;Marcus&lt;/b&gt;')
  })

  it('summarises the send for the card in plain words', () => {
    expect(outreachSummary({ toEmail: 'marcus@example.com', cycleDueOn: '2027-01-15' }, 'Marcus Chen'))
      .toBe('Send the annual review invitation to Marcus Chen (review due Jan 15, 2027)')
    expect(outreachSummary({ toEmail: 'marcus@example.com', cycleDueOn: '2027-01-15' }, null)).toContain('to marcus@example.com')
  })
})

describe('settings', () => {
  it('reads the four columns with defaults where a column is missing', () => {
    expect(settingsFromRow(null)).toEqual({ enabled: false, monthsAfterSigning: 12, cadenceMonths: 12, leadDays: 14 })
    expect(settingsFromRow({ annual_review_outreach_enabled: true, annual_review_lead_days: 30 }))
      .toEqual({ enabled: true, monthsAfterSigning: 12, cadenceMonths: 12, leadDays: 30 })
  })

  it('checks a patch and explains what is wrong in a sentence', () => {
    expect(parseSettingsPatch({ enabled: true, leadDays: '21' })).toEqual({ enabled: true, leadDays: 21 })
    expect(parseSettingsPatch({})).toEqual({})
    expect(() => parseSettingsPatch({ enabled: 'yes' })).toThrow('enabled must be true or false')
    expect(() => parseSettingsPatch({ monthsAfterSigning: 0 })).toThrow('Months after signing must be a whole number between 1 and 60')
    expect(() => parseSettingsPatch({ cadenceMonths: 1.5 })).toThrow('Months between reviews')
    expect(() => parseSettingsPatch({ leadDays: 500 })).toThrow('Days of notice must be a whole number between 0 and 120')
  })

  it('has a Settings tab in the Workflow group that resolves for every staff user', () => {
    const workflow = SETTINGS_NAV.find(group => group.label === 'Workflow')
    expect(workflow?.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tab', tab: 'annual-review', label: 'Annual reviews' })]))
    expect(resolveSettingsTab('annual-review', false)).toBe('annual-review')
  })

  it('reads with any staff role and writes as an administrator', () => {
    const route = read('app/api/admin/settings/annual-review/route.ts')
    expect(route).toContain('requireAdmin(req)')
    expect(route).toContain('requireAdministrator(req)')
    expect(route).toContain('parseSettingsPatch(body)')
  })
})

describe('the send through the delegation dial', () => {
  const actor = { id: '00000000-0000-0000-0000-000000000001' }

  it('is an external write, so the dial can never make it silent', () => {
    const definition = getActionDefinition('annual_review.outreach.send')
    expect(definition?.risk).toBe('external_write')
    expect(ACTION_CATALOG['annual_review.outreach.send']).toMatchObject({ group: 'communications' })
  })

  it('validates the invitation reference', () => {
    const definition = getActionDefinition('annual_review.outreach.send')
    expect(() => definition?.validate({ outreachId: 'nope' }, actor)).toThrow('valid invitation identifier')
    expect(definition?.validate({ outreachId: '00000000-0000-0000-0000-000000000030', extra: 'dropped' }, actor))
      .toEqual({ outreachId: '00000000-0000-0000-0000-000000000030' })
  })

  it('has its own email category addressed to the client', () => {
    expect(EMAIL_CATEGORIES).toContain('annual_review_outreach')
    expect(EMAIL_CATEGORY_META.annual_review_outreach.recipient).toBe('client')
  })

  it('always creates the proposal so the card is the queue, and sends through the registry action', () => {
    const server = read('lib/annualReview/server.ts')
    expect(server).toContain("actionKey: ANNUAL_REVIEW_ACTION_KEY")
    expect(server).toContain('applyAutonomy: true')
    expect(server).toContain('idempotencyKey: `annual-review:${row.id}`')
    expect(server).not.toContain("resolveActionAutonomy")
    expect(server).toContain("category: 'annual_review_outreach'")
    expect(server).toContain("useStoredTemplate: false")
    // A client with a portal account gets the same words there too.
    expect(server).toContain("sender_role: 'attorney'")
    expect(server).toContain("event_type: 'email_sent'")
  })

  it('refuses to send anything but a drafted invitation', () => {
    const server = read('lib/annualReview/server.ts')
    expect(server).toContain("if (row.status !== 'drafted') throw new Error('This invitation has already been sent or set aside')")
  })
})

describe('the daily run', () => {
  it('is a system automation with a matching deployment cron', () => {
    const automation = SYSTEM_AUTOMATIONS.find(entry => entry.key === 'annual-review-outreach')
    expect(automation).toMatchObject({ path: '/api/cron/annual-review-outreach', schedules: ['20 12 * * 1-5'] })
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    expect(vercel.crons).toContainEqual({ path: '/api/cron/annual-review-outreach', schedule: '20 12 * * 1-5' })
  })

  it('runs as the firm attorney under the shared run control and does nothing while off', () => {
    const route = read('app/api/cron/annual-review-outreach/route.ts')
    expect(route).toContain("runSystemAutomation('annual-review-outreach'")
    expect(route).toContain('resolveUnattendedActor()')
    expect(route).toContain('CRON_SECRET')
    const server = read('lib/annualReview/server.ts')
    expect(server).toContain('if (!settings.enabled) return result')
    // A second run on the same day meets the unique key, not a second email.
    expect(server).toContain("inserted.error.code === '23505'")
  })

  it('ships the schema: settings columns, the opt-out, the outreach table, and the rule row', () => {
    const migration = read('supabase/migrations/20270116090000_annual_review_outreach.sql')
    for (const column of ['annual_review_outreach_enabled', 'annual_review_months_after_signing', 'annual_review_cadence_months', 'annual_review_lead_days']) {
      expect(migration).toContain(column)
    }
    expect(migration).toContain('add column if not exists annual_review_opt_out boolean not null default false')
    expect(migration).toContain('create table if not exists public.annual_review_outreach')
    expect(migration).toContain('unique (matter_id, cycle_due_on)')
    expect(migration).toContain("check (status in ('drafted', 'sent', 'skipped', 'failed'))")
    expect(migration).toContain("'system:annual-review-outreach'")
    expect(migration).toContain('enable row level security')

    const types = read('packages/db-types/src/supabase.generated.ts')
    expect(types).toContain('annual_review_outreach: {')
    expect(types).toContain('annual_review_opt_out: boolean')
    expect(types).toContain('annual_review_outreach_enabled: boolean')
  })

  it('lets staff switch a matter out of the campaign', () => {
    expect(read('app/api/admin/matter-details/route.ts')).toContain("'annual_review_opt_out'")
    expect(read('app/admin/matters/[id]/tabs/billing-cards.tsx')).toContain("onSaveField('annual_review_opt_out'")
  })
})
