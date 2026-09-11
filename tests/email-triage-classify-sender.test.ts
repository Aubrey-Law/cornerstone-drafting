import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMatterIdByEmail: vi.fn(),
  findLeadByEmail: vi.fn(),
  findMatterIdByLeadId: vi.fn(),
  contactRow: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/bookings/link', () => ({
  findMatterIdByEmail: mocks.findMatterIdByEmail,
  findLeadByEmail: mocks.findLeadByEmail,
  findMatterIdByLeadId: mocks.findMatterIdByLeadId,
}))

import {
  EMPTY_IGNORE_RULES,
  classifySender,
  emailDomain,
  isAutomatedSender,
  stripPlusTag,
  type IgnoreRules,
} from '@/lib/emailTriage/classifySender'

/**
 * Two failure modes, and they are not symmetrical. A newsletter in the queue is
 * noise the attorney scrolls past; a real client filtered out as a newsletter is
 * a client who waits and never knows why. The ordering tests below are the ones
 * that keep the second from happening.
 */

// A chainable stub of the Supabase query builder, ending in maybeSingle().
function adminStub() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'ilike', 'is', 'order', 'limit']) {
    builder[method] = () => builder
  }
  builder.maybeSingle = async () => ({ data: mocks.contactRow, error: null })
  return { from: () => builder } as never
}

const BASE = {
  email: 'jane@example.com',
  name: 'Jane Doe',
  headers: {} as Record<string, string>,
  labelIds: ['INBOX'],
  subject: 'Question about my trust',
  ignore: EMPTY_IGNORE_RULES,
  connectedAddress: 'scott@aubreylegal.com',
  firmDomains: ['aubreylegal.com'],
  threadsFromSender: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findMatterIdByEmail.mockResolvedValue(null)
  mocks.findLeadByEmail.mockResolvedValue(null)
  mocks.findMatterIdByLeadId.mockResolvedValue(null)
  mocks.contactRow = null
})

describe('address helpers', () => {
  it('reads the domain, including one with a dot in the local part', () => {
    expect(emailDomain('jane.doe@mail.example.co.uk')).toBe('mail.example.co.uk')
  })

  it('strips a +tag so a tagged address still finds its record', () => {
    expect(stripPlusTag('jane+estate@example.com')).toBe('jane@example.com')
    expect(stripPlusTag('jane@example.com')).toBe('jane@example.com')
  })
})

describe('isAutomatedSender — unambiguous cases', () => {
  const hard = (over: Partial<typeof BASE>) => isAutomatedSender({ ...BASE, ...over })

  it('treats mailing-list headers as proof', () => {
    expect(hard({ headers: { 'list-unsubscribe': '<https://x>' } })).toMatchObject({ hard: true })
    expect(hard({ headers: { 'list-id': '<news.x>' } })).toMatchObject({ hard: true })
  })

  it('treats Precedence: bulk as proof', () => {
    expect(hard({ headers: { precedence: 'bulk' } })).toMatchObject({ hard: true })
  })

  it('treats Auto-Submitted as proof, except the "no" that means a human', () => {
    expect(hard({ headers: { 'auto-submitted': 'auto-replied' } })).toMatchObject({ hard: true })
    expect(hard({ headers: { 'auto-submitted': 'no' } })).toMatchObject({ automated: false })
  })

  it('recognises the local parts that are never a person', () => {
    for (const local of ['noreply', 'no-reply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'bounces']) {
      expect(hard({ email: `${local}@example.com` })).toMatchObject({ hard: true })
    }
  })

  it('recognises an out-of-office by its subject', () => {
    expect(hard({ subject: 'Automatic reply: Question about my trust' })).toMatchObject({ hard: true })
    expect(hard({ subject: 'Out of Office' })).toMatchObject({ hard: true })
  })

  it('honours the attorney’s own ignore list', () => {
    const ignore: IgnoreRules = { domains: new Set(['vendor.com']), addresses: new Set() }
    expect(hard({ email: 'a@vendor.com', ignore })).toMatchObject({ hard: true })

    const byAddress: IgnoreRules = { domains: new Set(), addresses: new Set(['x@other.com']) }
    expect(hard({ email: 'x@other.com', ignore: byAddress })).toMatchObject({ hard: true })
  })
})

describe('isAutomatedSender — requires two signals', () => {
  it('does not condemn info@ on its own', () => {
    // At a two-person business this is someone's actual inbox, and it is
    // exactly the address a new client enquiry arrives from.
    expect(isAutomatedSender({ ...BASE, email: 'info@smallbusiness.com' }))
      .toMatchObject({ automated: false })
  })

  it('does not condemn a Gmail bulk category on its own', () => {
    expect(isAutomatedSender({ ...BASE, labelIds: ['INBOX', 'CATEGORY_UPDATES'] }))
      .toMatchObject({ automated: false })
  })

  it('condemns info@ once a second signal agrees', () => {
    const verdict = isAutomatedSender({
      ...BASE,
      email: 'info@vendor.com',
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
    })
    expect(verdict).toMatchObject({ automated: true, hard: false })
  })

  it('condemns a nameless sender carrying bulk-sender headers', () => {
    const verdict = isAutomatedSender({
      ...BASE,
      name: null,
      headers: { 'feedback-id': 'campaign:123' },
    })
    expect(verdict).toMatchObject({ automated: true, hard: false })
  })
})

describe('classifySender', () => {
  it('files the firm’s own mail as internal', async () => {
    const match = await classifySender(adminStub(), { ...BASE, email: 'scott@aubreylegal.com' })
    expect(match.classification).toBe('internal')
    expect(mocks.findMatterIdByEmail).not.toHaveBeenCalled()
  })

  it('files a hired client as a client, not as the lead they arrived as', async () => {
    // A hired client keeps their client_intake row. Checking matters first is
    // what stops them being filed as a lead for the rest of the engagement.
    mocks.findMatterIdByEmail.mockResolvedValue('matter-1')
    mocks.findLeadByEmail.mockResolvedValue({ id: 'lead-1', lead_status: 'hired' })

    const match = await classifySender(adminStub(), BASE)
    expect(match).toMatchObject({ classification: 'client', matterId: 'matter-1' })
  })

  it('files a lead with its opportunity matter', async () => {
    mocks.findLeadByEmail.mockResolvedValue({
      id: 'lead-1',
      lead_status: 'new',
      full_name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
    })
    mocks.findMatterIdByLeadId.mockResolvedValue('matter-9')

    const match = await classifySender(adminStub(), BASE)
    expect(match).toMatchObject({
      classification: 'lead',
      clientIntakeId: 'lead-1',
      matterId: 'matter-9',
      displayName: 'Jane Doe',
    })
  })

  it('falls back to first and last name when a lead has no full_name', async () => {
    mocks.findLeadByEmail.mockResolvedValue({
      id: 'lead-1', lead_status: 'new', full_name: null, first_name: 'Jane', last_name: 'Doe',
    })
    const match = await classifySender(adminStub(), BASE)
    expect(match.displayName).toBe('Jane Doe')
  })

  it('files a related person as a contact', async () => {
    mocks.contactRow = {
      id: 'contact-1',
      first_name: 'Bob',
      last_name: 'Smith',
      relationship_type: 'successor_trustee',
      client_intake_id: 'lead-2',
    }
    const match = await classifySender(adminStub(), BASE)
    expect(match).toMatchObject({
      classification: 'contact',
      contactId: 'contact-1',
      displayName: 'Bob Smith',
    })
  })

  it('files a stranger as a possible new lead rather than dropping them', async () => {
    const match = await classifySender(adminStub(), BASE)
    expect(match.classification).toBe('possible_lead')
  })

  it('keeps a known client that Gmail filed under a bulk category', async () => {
    // The ordering assertion that matters most. Gmail miscategorises real mail,
    // and a client asking a question must not be filtered out for it.
    mocks.findMatterIdByEmail.mockResolvedValue('matter-1')
    const match = await classifySender(adminStub(), {
      ...BASE,
      name: null,
      labelIds: ['INBOX', 'CATEGORY_UPDATES'],
    })
    expect(match.classification).toBe('client')
  })

  it('drops a client’s own out-of-office, which is not a question', async () => {
    mocks.findMatterIdByEmail.mockResolvedValue('matter-1')
    const match = await classifySender(adminStub(), {
      ...BASE,
      subject: 'Automatic reply: Your estate plan',
    })
    expect(match.classification).toBe('automated')
  })

  it('matches a +tagged address to the record it belongs to', async () => {
    mocks.findMatterIdByEmail.mockImplementation(async (_admin: unknown, email: string) =>
      email === 'jane@example.com' ? 'matter-1' : null)

    const match = await classifySender(adminStub(), { ...BASE, email: 'jane+estate@example.com' })
    expect(match).toMatchObject({ classification: 'client', matterId: 'matter-1' })
  })

  it('carries a reason so a wrong call can be argued with', async () => {
    const match = await classifySender(adminStub(), BASE)
    expect(match.reason).toBeTruthy()
  })
})

/**
 * Regressions from the first production scan.
 *
 * That run queued 17 threads and one of them was worth reading. These pin the
 * senders that got through, using their real shapes — because the rules looked
 * reasonable in the abstract and were wrong against an actual law firm's inbox.
 */
describe('isAutomatedSender — the first production scan', () => {
  const check = (over: Partial<typeof BASE>) => isAutomatedSender({ ...BASE, ...over })

  it('catches a claims desk filing ticket after ticket', () => {
    // Seven of these reached the queue as possible new leads. Three signals
    // agree: a role local part, a reference number, and the volume.
    const verdict = check({
      email: 'claims@legaleaseplan.com',
      name: 'LegalEASE Claims',
      subject: 'Claim #43667 First Request for Claim Information',
      threadsFromSender: 7,
    })
    expect(verdict.automated).toBe(true)
  })

  it('catches an invoice notification', () => {
    const verdict = check({
      email: 'messenger@messaging.squareup.com',
      name: 'Square',
      subject: 'You have an invoice waiting (#000189)',
      threadsFromSender: 2,
    })
    expect(verdict.automated).toBe(true)
  })

  it('sees a hyphenated department mailer as one signal, not proof', () => {
    // `ar-simplifile@` is a role address with a suffix, which the plain
    // local-part set cannot match — so the prefix rule earns a signal here.
    //
    // But one signal is deliberately not enough, and this notice offers
    // nothing else: a real display name, no reference number, a single
    // thread. Condemning it would mean condemning `info@smallbusiness.com`
    // on identical evidence, which is the enquiry this whole rule protects.
    // So the structural rules decline, and the ignore list is what silences
    // it — which is exactly what the ignore list is for.
    const verdict = check({
      email: 'ar-simplifile@ice.com',
      name: 'Simplifile AR',
      subject: 'eRecording License Payment Scheduled',
      threadsFromSender: 1,
    })
    expect(verdict.reason).toBeNull()
    expect(verdict.automated).toBe(false)

    const ignored = check({
      email: 'ar-simplifile@ice.com',
      name: 'Simplifile AR',
      subject: 'eRecording License Payment Scheduled',
      ignore: { domains: new Set(['simplifile.com', 'ice.com']), addresses: new Set() },
    })
    expect(ignored).toMatchObject({ automated: true, hard: true })
  })

  it('catches a panel billing inquiry', () => {
    const verdict = check({
      email: 'panel@legalplans.com',
      name: 'Legal Plans Panel',
      subject: 'Billing Inquiry — account 88213',
      threadsFromSender: 1,
    })
    expect(verdict.automated).toBe(true)
  })

  it('still lets a real person through, however they are addressed', () => {
    // The case the two-signal rule exists to protect, and the one row from
    // that scan that actually mattered.
    expect(check({
      email: 'andresen.jola@gmail.com',
      name: 'J Andresen',
      subject: 'Re: Aubrey Law - Invitation to your Client Portal',
      threadsFromSender: 1,
    }).automated).toBe(false)
  })

  it('does not condemn a one-off enquiry from a small firm’s shared inbox', () => {
    expect(check({
      email: 'info@smallbusiness.com',
      name: 'Dana Reeve',
      subject: 'Question about setting up a trust',
      threadsFromSender: 1,
    }).automated).toBe(false)
  })

  it('does not condemn a client who happens to write often', () => {
    // Volume alone is one signal. A client mid-matter can easily open three
    // threads in a fortnight, and must not be filtered for it.
    expect(check({
      email: 'jane@example.com',
      name: 'Jane Doe',
      subject: 'One more question about the trustee',
      threadsFromSender: 5,
    }).automated).toBe(false)
  })

  it('does not read a year or a street number as a reference number', () => {
    expect(check({
      email: 'jane@example.com',
      name: 'Jane Doe',
      subject: 'Moving to 1247 Beacon St in 2026 — does the deed change?',
      threadsFromSender: 1,
    }).automated).toBe(false)
  })

  it('defaults to one thread when the caller does not count', () => {
    const { threadsFromSender: _omitted, ...withoutCount } = BASE
    expect(isAutomatedSender(withoutCount as typeof BASE).automated).toBe(false)
  })
})
