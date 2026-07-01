import { describe, expect, it } from 'vitest'
import { docSelectionTemplateKey } from '@/lib/drafting/docSelectionKey'

describe('drafting doc selection keys', () => {
  it('uses the hosted doc_selections schema to build client and spouse template keys', () => {
    expect(docSelectionTemplateKey({
      doc_type: 'will_individual',
      variant: null,
      party: 'client',
    })).toBe('will_individual')

    expect(docSelectionTemplateKey({
      doc_type: 'will_individual',
      variant: 'testamentary',
      party: 'spouse',
    })).toBe('will_individual:testamentary:spouse')
  })

  it('ignores empty doc types instead of producing unusable template keys', () => {
    expect(docSelectionTemplateKey({
      doc_type: '   ',
      variant: 'testamentary',
      party: 'client',
    })).toBeNull()
  })
})
