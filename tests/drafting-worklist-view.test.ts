import { describe, expect, it } from 'vitest'
import { hubViewUrl, parseHubView, parseSavedHubViews } from '@/lib/drafting/hubView'

describe('drafting worklist views', () => {
  it('round-trips a bookmarked view including encoded searches and practice areas', () => {
    const view = { search: 'Doe & family', sort: 'client' as const, action: 'review' as const, practice: 'Estate Planning' }
    expect(parseHubView(new URL(hubViewUrl(view), 'https://example.test').searchParams)).toEqual(view)
  })
  it('normalizes unsupported filters and explicitly represents the cleared view', () => {
    const view = parseHubView(new URLSearchParams('sort=wrong&action=wrong'))
    expect(view).toEqual({ search: '', sort: 'updated', action: 'all', practice: 'all' })
    expect(hubViewUrl(view)).toBe('/admin/drafting?view=all')
  })
  it('validates and bounds named views read from preferences', () => {
    expect(parseSavedHubViews([null, { name: '' }, { name: ' My review ', search: 'Doe', action: 'review', sort: 'bad' }]))
      .toEqual([{ name: 'My review', search: 'Doe', action: 'review', sort: 'updated', practice: 'all' }])
  })
})
