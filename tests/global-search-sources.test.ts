import { describe, expect, it } from 'vitest'

import {
  contactHit,
  contactName,
  invoiceHit,
  matterHit,
  recentHit,
  sanitizeTerm,
  taskHit,
} from '@/lib/search/globalSearchSources'

/**
 * ⌘K reached matters only. These pin the shape of the four sources it reaches
 * now — mainly that every hit carries a destination that exists, since a
 * palette that finds a thing and then cannot open it is worse than one that
 * never found it.
 */
describe('global search sources', () => {
  describe('sanitizeTerm', () => {
    it('drops the characters PostgREST reads as filter syntax', () => {
      // `%` would make the ilike match everything; `,` and the parens end the
      // or() clause early and the request fails to parse.
      expect(sanitizeTerm('50%, (draft)')).toBe('50 draft')
      expect(sanitizeTerm('  Smith  ')).toBe('Smith')
    })
  })

  describe('contactName', () => {
    const base = { id: 'c1', first_name: null, last_name: null, preferred_name: null, email: null, phone: null }

    it('replaces the first name rather than joining it', () => {
      // A Robert who goes by Bob is "Bob Smith", never "Bob Robert Smith".
      expect(
        contactName({ ...base, first_name: 'Robert', preferred_name: 'Bob', last_name: 'Smith' }),
      ).toBe('Bob Smith')
    })

    it('falls back through what it has', () => {
      expect(contactName({ ...base, first_name: 'Robert', last_name: 'Smith' })).toBe('Robert Smith')
      expect(contactName({ ...base, last_name: 'Smith' })).toBe('Smith')
      expect(contactName(base)).toBe('Unnamed contact')
    })
  })

  describe('destinations', () => {
    it('sends a matter to its record', () => {
      expect(
        matterHit({ matter_id: 'm1', matter_name: 'Trust', client_name: 'Okonkwo', stage: 'Drafting' }),
      ).toEqual({ kind: 'matter', id: 'm1', label: 'Okonkwo', detail: 'Drafting', href: '/admin/matters/m1' })
    })

    it('prefers the client name over the matter name', () => {
      const hit = matterHit({ matter_id: 'm1', matter_name: 'Trust', client_name: 'Okonkwo', stage: null })
      expect(hit.label).toBe('Okonkwo')
    })

    it('sends a contact to the selection the contacts table already supports', () => {
      // No new route: the softphone deep-links with this same parameter.
      expect(
        contactHit({ id: 'c1', first_name: 'Ada', last_name: 'Lovelace', preferred_name: null, email: 'ada@example.com', phone: '555' }),
      ).toEqual({
        kind: 'contact',
        id: 'c1',
        label: 'Ada Lovelace',
        detail: 'ada@example.com',
        href: '/admin/contacts?selected=c1',
      })
    })

    it('sends a task to the list with itself focused', () => {
      expect(taskHit({ id: 't1', title: 'Draft the deed', status: 'open', matter_id: 'm1' })).toEqual({
        kind: 'task',
        id: 't1',
        label: 'Draft the deed',
        detail: 'open',
        href: '/admin/tasks?focus=t1',
      })
    })

    it('sends an invoice to its record', () => {
      expect(
        invoiceHit({ id: 'i1', number: '1042', status: 'sent', bill_to_name: 'Okonkwo' }),
      ).toEqual({
        kind: 'invoice',
        id: 'i1',
        label: 'Invoice 1042',
        detail: 'Okonkwo',
        href: '/admin/billing/invoices/i1',
      })
    })

    it('names an unnumbered invoice for what it is', () => {
      // Numbers are assigned on issue, so a draft has none.
      expect(invoiceHit({ id: 'i2', number: null, status: 'draft', bill_to_name: null }).label).toBe(
        'Draft invoice',
      )
    })

    it('escapes an id rather than splicing it into the URL raw', () => {
      expect(contactHit({ id: 'a b&c', first_name: 'X', last_name: null, preferred_name: null, email: null, phone: null }).href).toBe(
        '/admin/contacts?selected=a%20b%26c',
      )
    })
  })

  describe('recents', () => {
    it('reuses the sidebar rows the shell already fetched', () => {
      expect(recentHit({ matter_id: 'm9', title: 'Alvarez', client_name: 'Alvarez' })).toEqual({
        kind: 'matter',
        id: 'm9',
        label: 'Alvarez',
        href: '/admin/matters/m9',
      })
    })
  })

  it('gives every hit a label and an admin destination', () => {
    const hits = [
      matterHit({ matter_id: 'm', matter_name: null, client_name: null, stage: null }),
      contactHit({ id: 'c', first_name: null, last_name: null, preferred_name: null, email: null, phone: null }),
      taskHit({ id: 't', title: null, status: null, matter_id: null }),
      invoiceHit({ id: 'i', number: null, status: null, bill_to_name: null }),
    ]
    for (const hit of hits) {
      expect(hit.label.trim(), hit.kind).not.toBe('')
      expect(hit.href, hit.kind).toMatch(/^\/admin\//)
    }
  })
})
