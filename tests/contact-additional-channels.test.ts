import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  ContactChannelError,
  buildAlternateEmails,
  MAX_ADDITIONAL_CHANNELS,
  formatContactChannel,
  normalizeContactChannels,
  parseContactChannels,
} from '@/lib/contacts/additionalChannels'

describe('parseContactChannels', () => {
  it('reads labelled entries and tolerates a bare string list', () => {
    expect(parseContactChannels([{ label: 'Work', value: ' a@b.com ' }, 'c@d.com'])).toEqual([
      { label: 'Work', value: 'a@b.com' },
      { label: '', value: 'c@d.com' },
    ])
  })

  it('answers with an empty list for anything that is not an array', () => {
    for (const raw of [null, undefined, '', 42, { value: 'a@b.com' }]) {
      expect(parseContactChannels(raw)).toEqual([])
    }
  })

  it('drops entries with no value rather than rendering blanks', () => {
    expect(parseContactChannels([{ label: 'Work', value: '   ' }, { label: 'Home' }])).toEqual([])
  })
})

describe('normalizeContactChannels', () => {
  it('lower-cases emails and drops the one already in the primary column', () => {
    const channels = normalizeContactChannels(
      [{ label: 'Work', value: 'Work@Example.com' }, { label: 'Same', value: 'PRIMARY@example.com' }],
      'email',
      'primary@example.com',
    )
    expect(channels).toEqual([{ label: 'Work', value: 'work@example.com' }])
  })

  it('stores phones in the same shape as the primary column and dedupes by digits', () => {
    const channels = normalizeContactChannels(
      [{ label: 'Mobile', value: '6175550184' }, { label: 'Again', value: '(617) 555-0184' }],
      'phone',
      null,
    )
    expect(channels).toEqual([{ label: 'Mobile', value: '(617) 555-0184' }])
  })

  it('drops a phone that repeats the primary number in another format', () => {
    expect(normalizeContactChannels([{ label: '', value: '617-555-0184' }], 'phone', '(617) 555-0184'))
      .toEqual([])
  })

  it('rejects an unusable entry so the caller can answer 400', () => {
    expect(() => normalizeContactChannels([{ label: '', value: 'nope' }], 'email', null))
      .toThrow(ContactChannelError)
    expect(() => normalizeContactChannels([{ label: '', value: '555-01' }], 'phone', null))
      .toThrow(ContactChannelError)
    expect(() => normalizeContactChannels('a@b.com', 'email', null)).toThrow(ContactChannelError)
  })

  it('treats a missing list as nothing to change', () => {
    expect(normalizeContactChannels(null, 'email', null)).toEqual([])
    expect(normalizeContactChannels(undefined, 'phone', null)).toEqual([])
  })

  it('keeps the cap the column constraint enforces', () => {
    const many = Array.from({ length: MAX_ADDITIONAL_CHANNELS + 3 }, (_, index) => ({
      label: '',
      value: `person${index}@example.com`,
    }))
    expect(normalizeContactChannels(many, 'email', null)).toHaveLength(MAX_ADDITIONAL_CHANNELS)
  })
})

describe('formatContactChannel', () => {
  it('prefixes the label when there is one and formats phone digits', () => {
    expect(formatContactChannel({ label: 'Mobile', value: '6175550184' }, 'phone'))
      .toBe('Mobile · (617) 555-0184')
    expect(formatContactChannel({ label: '', value: 'a@b.com' }, 'email')).toBe('a@b.com')
  })
})

describe('the columns behind them', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260914000000_contact_additional_channels.sql',
    'utf8',
  )

  it('adds both lists to the client row and to contacts', () => {
    for (const table of ['client_intake', 'contacts']) {
      expect(migration).toContain(`alter table public.${table}`)
    }
    expect(migration.match(/additional_emails jsonb not null default '\[\]'::jsonb/g)).toHaveLength(2)
    expect(migration.match(/additional_phones jsonb not null default '\[\]'::jsonb/g)).toHaveLength(2)
  })

  it('guards the stored shape so a reader never meets an entry it cannot parse', () => {
    expect(migration).toContain('is_contact_channel_list')
    expect(migration).toContain(`jsonb_array_length(value) <= ${MAX_ADDITIONAL_CHANNELS}`)
  })

  it('reloads PostgREST so the new columns are selectable straight away', () => {
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })
})

describe('buildAlternateEmails', () => {
  it('offers the spouse first, then each side’s extras, labelled', () => {
    expect(buildAlternateEmails(
      [
        {
          person: 'Robert Chen',
          primary: 'robert@example.com',
          additional: [{ label: 'Work', value: 'r.chen@firm.example.com' }],
        },
        { person: 'Client', additional: [{ label: '', value: 'margaret@personal.example.com' }] },
      ],
      'margaret@example.com',
    )).toEqual([
      { label: 'Robert Chen', email: 'robert@example.com' },
      { label: 'Robert Chen · Work', email: 'r.chen@firm.example.com' },
      { label: 'Client', email: 'margaret@personal.example.com' },
    ])
  })

  it('never offers the address the composer already put in the To field', () => {
    expect(buildAlternateEmails(
      [{ person: 'Client', additional: [{ label: 'Same', value: 'MARGARET@example.com' }] }],
      'margaret@example.com',
    )).toEqual([])
  })

  it('skips a person with nothing to offer', () => {
    expect(buildAlternateEmails([{ person: 'Spouse', primary: null }], null)).toEqual([])
  })
})

describe('the routes that write them', () => {
  it('normalizes on the matter contacts route and answers 400 on a bad entry', () => {
    const route = fs.readFileSync('app/api/admin/matters/[id]/contacts/route.ts', 'utf8')
    expect(route).toContain("normalizeContactChannels(value, 'email', primaryEmail)")
    expect(route).toContain("normalizeContactChannels(value, 'phone', primaryPhone)")
    expect(route).toContain('error instanceof ContactChannelError')
    expect(route).toContain('{ status: 400 }')
  })

  it('gives leads their own channels route rather than widening the audited field RPC', () => {
    const route = fs.readFileSync('app/api/admin/leads/[id]/channels/route.ts', 'utf8')
    expect(route).toContain('requireAdmin')
    expect(route).toContain("target !== 'client' && target !== 'spouse'")
    expect(route).toContain("relationship_type', 'spouse'")
    expect(route).toContain('normalizeContactChannels')

    // The RPC's whitelist stays as it was — lifecycle fields only.
    const leadFields = fs.readFileSync('lib/leads/details.ts', 'utf8')
    expect(leadFields).not.toContain('additional_emails')
  })
})
