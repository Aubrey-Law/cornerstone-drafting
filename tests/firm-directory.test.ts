import { describe, expect, it } from 'vitest'
import {
  buildFirmPeople,
  toEmailDirectory,
  toPhoneDirectory,
} from '@/lib/queries/firmDirectory'

type Intake = Parameters<typeof buildFirmPeople>[0][number]
type Contact = Parameters<typeof buildFirmPeople>[1][number]
type Matter = Parameters<typeof buildFirmPeople>[2][number]

const intake = (o: Partial<Intake> & Pick<Intake, 'id'>): Intake => ({
  full_name: null,
  first_name: null,
  last_name: null,
  preferred_name: null,
  email: null,
  phone: null,
  practice_area: null,
  lead_status: null,
  matter_id: null,
  ...o,
})

const contact = (o: Partial<Contact> & Pick<Contact, 'id'>): Contact => ({
  client_intake_id: null,
  first_name: null,
  last_name: null,
  preferred_name: null,
  email: null,
  phone: null,
  relationship_type: null,
  relationship_label: null,
  deceased: null,
  ...o,
})

const matter = (o: Partial<Matter> & Pick<Matter, 'id'>): Matter => ({
  matter_number: null,
  relationship_status: null,
  status: 'open',
  stage: null,
  ...o,
})

// A hired client, a lead (which post-unify HAS a matter row), a fiduciary on
// the hired matter, and a standalone referrer with no intake at all.
const MATTERS = [
  matter({ id: 'm-hired', matter_number: '2026-EP-adams', relationship_status: 'hired', stage: 'drafting' }),
  matter({ id: 'm-lead', relationship_status: 'lead' }),
]
const INTAKES = [
  intake({ id: 'i-alice', full_name: 'Alice Adams', email: 'alice@example.com', phone: '(617) 555-0101', matter_id: 'm-hired', practice_area: 'estate_planning' }),
  intake({ id: 'i-bob', full_name: 'Bob Brown', email: 'bob@example.com', phone: '617-555-0102', matter_id: 'm-lead', lead_status: 'lead' }),
]
const CONTACTS = [
  contact({ id: 'c-trustee', client_intake_id: 'i-alice', first_name: 'Tina', last_name: 'Trust', relationship_type: 'trustee', phone: '(617) 555-0103', email: 'tina@example.com' }),
  contact({ id: 'c-cpa', first_name: 'Rita', last_name: 'Referrer', relationship_label: 'Referring CPA', phone: '6175550104', email: 'rita@cpa.example.com' }),
]

const build = () => buildFirmPeople(INTAKES, CONTACTS, MATTERS)

describe('buildFirmPeople', () => {
  it('includes a lead that has a matter row', () => {
    // Regression: the phone directory filtered intakes on `matter_id is null`,
    // but unify_leads_matters backfilled a matter for every intake, so this
    // person had disappeared from the softphone entirely.
    const bob = build().find(p => p.intakeId === 'i-bob')
    expect(bob).toBeDefined()
    expect(bob?.relationshipStatus).toBe('lead')
    // Leads thread through the intake, not the opportunity matter.
    expect(bob?.leadId).toBe('i-bob')
    expect(bob?.matterId).toBeNull()
  })

  it('threads a hired client through the matter', () => {
    const alice = build().find(p => p.intakeId === 'i-alice')
    expect(alice?.matterId).toBe('m-hired')
    expect(alice?.leadId).toBeNull()
    expect(alice?.detail).toBe('2026-EP-adams')
  })

  it('includes relationship contacts and standalone contacts', () => {
    const people = build()
    expect(people.find(p => p.contactId === 'c-trustee')?.detail).toBe('Trustee · Alice Adams')
    expect(people.find(p => p.contactId === 'c-cpa')?.detail).toBe('Referring CPA')
  })

  it('lets a fiduciary inherit the matter it hangs off', () => {
    const tina = build().find(p => p.contactId === 'c-trustee')
    expect(tina?.matterId).toBe('m-hired')
    expect(tina?.practiceArea).toBe('estate_planning')
    expect(tina?.stage).toBe('drafting')
  })

  it('drops deceased, blank and placeholder-named contacts', () => {
    const people = buildFirmPeople([], [
      contact({ id: 'c-dead', first_name: 'Gone', last_name: 'Away', deceased: true, phone: '6175550105' }),
      contact({ id: 'c-blank', phone: '6175550106' }),
      contact({ id: 'c-tbd', first_name: 'To be determined', phone: '6175550107' }),
      contact({ id: 'c-ok', first_name: 'Real', last_name: 'Person', phone: '6175550108' }),
    ], [])
    expect(people.map(p => p.contactId)).toEqual(['c-ok'])
  })

  it('drops people whose matter was archived out of the query', () => {
    // The matters query filters status <> 'archived', so an intake pointing at
    // a missing matter row is archived — and so is anyone hanging off it.
    const people = buildFirmPeople(
      [intake({ id: 'i-gone', full_name: 'Archived Client', matter_id: 'm-archived', phone: '6175550109' })],
      [contact({ id: 'c-gone', client_intake_id: 'i-gone', first_name: 'Their', last_name: 'Trustee', phone: '6175550110' })],
      [],
    )
    expect(people).toEqual([])
  })
})

describe('toPhoneDirectory', () => {
  it('lists every person who has a dialable number', () => {
    expect(toPhoneDirectory(build()).map(e => e.name).sort()).toEqual([
      'Alice Adams', 'Bob Brown', 'Rita Referrer', 'Tina Trust',
    ])
  })

  it('normalizes assorted phone formats to the last ten digits', () => {
    expect(toPhoneDirectory(build()).map(e => e.digits).sort()).toEqual([
      '6175550101', '6175550102', '6175550103', '6175550104',
    ])
  })

  it('carries contactId through so a contact-scoped call can be logged', () => {
    const entries = toPhoneDirectory(build())
    expect(entries.find(e => e.digits === '6175550103')?.contactId).toBe('c-trustee')
    expect(entries.find(e => e.digits === '6175550101')?.contactId).toBeNull()
  })

  it('gives a shared number to the most specific person', () => {
    // hired client > their contact > lead > lead's contact > standalone
    const shared = '(617) 555-0199'
    const people = buildFirmPeople(
      [
        intake({ id: 'i-alice', full_name: 'Alice Adams', phone: shared, matter_id: 'm-hired' }),
        intake({ id: 'i-bob', full_name: 'Bob Brown', phone: shared, matter_id: 'm-lead', lead_status: 'lead' }),
      ],
      [
        contact({ id: 'c-spouse', client_intake_id: 'i-alice', first_name: 'Dan', last_name: 'Adams', relationship_type: 'spouse', phone: shared }),
        contact({ id: 'c-cpa', first_name: 'Rita', last_name: 'Referrer', phone: shared }),
      ],
      MATTERS,
    )
    const entries = toPhoneDirectory(people)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('Alice Adams')
  })

  it("ranks a hired client's spouse above an unrelated lead", () => {
    const shared = '6175550200'
    const people = buildFirmPeople(
      [
        intake({ id: 'i-alice', full_name: 'Alice Adams', matter_id: 'm-hired' }),
        intake({ id: 'i-bob', full_name: 'Bob Brown', phone: shared, matter_id: 'm-lead', lead_status: 'lead' }),
      ],
      [contact({ id: 'c-spouse', client_intake_id: 'i-alice', first_name: 'Dan', last_name: 'Adams', relationship_type: 'spouse', phone: shared })],
      MATTERS,
    )
    expect(toPhoneDirectory(people)[0]?.name).toBe('Dan Adams')
  })

  it('ranks a lost lead below everyone else', () => {
    const shared = '6175550201'
    const people = buildFirmPeople(
      [
        intake({ id: 'i-lost', full_name: 'Lost Lead', phone: shared, lead_status: 'lost' }),
        intake({ id: 'i-bob', full_name: 'Bob Brown', phone: shared, matter_id: 'm-lead', lead_status: 'lead' }),
      ],
      [],
      MATTERS,
    )
    expect(toPhoneDirectory(people)[0]?.name).toBe('Bob Brown')
  })

  it('skips people with no number rather than emitting a blank key', () => {
    const people = buildFirmPeople([intake({ id: 'i-x', full_name: 'No Phone' })], [], [])
    expect(toPhoneDirectory(people)).toEqual([])
  })
})

describe('toEmailDirectory', () => {
  it('covers the same people as the phone directory', () => {
    // The two used to query different tables and drift; they now project from
    // one source, so anyone reachable by phone is reachable by email.
    const people = build()
    expect(toEmailDirectory(people).map(e => e.name).sort())
      .toEqual(toPhoneDirectory(people).map(e => e.name).sort())
  })

  it('lowercases addresses and rejects malformed ones', () => {
    const people = buildFirmPeople(
      [intake({ id: 'i-a', full_name: 'Mixed Case', email: '  Mixed@Example.COM ' })],
      [contact({ id: 'c-b', first_name: 'Bad', last_name: 'Address', email: 'not-an-email' })],
      [],
    )
    expect(toEmailDirectory(people)).toEqual([
      { email: 'mixed@example.com', name: 'Mixed Case', detail: 'Client' },
    ])
  })

  it('gives a shared address to the most specific person', () => {
    const people = buildFirmPeople(
      [intake({ id: 'i-alice', full_name: 'Alice Adams', email: 'household@example.com', matter_id: 'm-hired' })],
      [contact({ id: 'c-child', client_intake_id: 'i-alice', first_name: 'Kid', last_name: 'Adams', relationship_type: 'child', email: 'HOUSEHOLD@example.com' })],
      MATTERS,
    )
    expect(toEmailDirectory(people)).toHaveLength(1)
    expect(toEmailDirectory(people)[0]?.name).toBe('Alice Adams')
  })

  it('sorts by name for the typeahead', () => {
    expect(toEmailDirectory(build()).map(e => e.name)).toEqual([
      'Alice Adams', 'Bob Brown', 'Rita Referrer', 'Tina Trust',
    ])
  })
})
