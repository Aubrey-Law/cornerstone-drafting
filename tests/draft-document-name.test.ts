import { describe, expect, it } from 'vitest'
import {
  buildDraftDocumentName,
  sanitizeDraftNameSegment,
  titleFromOutputSlug,
} from '@/lib/estateGenerator/draftDocumentName'

describe('draft document naming', () => {
  it('builds date_owner_title.docx', () => {
    expect(buildDraftDocumentName({
      date: '2026-06-08',
      owner: 'Jane Smith',
      title: 'Durable Power of Attorney',
    })).toBe('2026-06-08_Jane Smith_Durable Power of Attorney.docx')
  })

  it('joins both spouses for a joint document', () => {
    expect(buildDraftDocumentName({
      date: '2026-06-08',
      owner: 'Jane Smith & John Smith',
      title: 'Joint Revocable Trust',
    })).toBe('2026-06-08_Jane Smith & John Smith_Joint Revocable Trust.docx')
  })

  it('strips path separators from a title that contains a slash', () => {
    expect(buildDraftDocumentName({
      date: '2026-06-08',
      owner: 'Jane Smith',
      title: 'Living Will / Advance Directive',
    })).toBe('2026-06-08_Jane Smith_Living Will Advance Directive.docx')
  })

  it('preserves hyphenated names', () => {
    expect(sanitizeDraftNameSegment('Mary-Jane Smith')).toBe('Mary-Jane Smith')
  })

  it('omits the owner segment when it is unknown', () => {
    expect(buildDraftDocumentName({
      date: '2026-06-08',
      owner: null,
      title: 'Health Care Proxy',
    })).toBe('2026-06-08_Health Care Proxy.docx')
  })

  it('derives a readable title from a generator slug', () => {
    expect(titleFromOutputSlug('01-durable-power-of-attorney.docx')).toBe('Durable Power Of Attorney')
  })
})
