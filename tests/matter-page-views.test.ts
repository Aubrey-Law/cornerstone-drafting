import { describe, expect, it } from 'vitest'
import { parseAssetView, parseDocumentView, parseTaskView } from '@/lib/matterPageTabs'

describe('matter tab views', () => {
  it('opens the Assets tab on its inventory unless ?view=funding', () => {
    expect(parseAssetView(null)).toBe('inventory')
    expect(parseAssetView('funding')).toBe('funding')
    // Another tab's view left in the URL is not this tab's.
    expect(parseAssetView('plan')).toBe('inventory')
  })

  it('opens the Documents tab on its files unless ?view=signing', () => {
    expect(parseDocumentView(undefined)).toBe('files')
    expect(parseDocumentView('signing')).toBe('signing')
    expect(parseDocumentView('funding')).toBe('files')
  })

  it('keeps the Tasks tab on its queue for a view it does not have', () => {
    expect(parseTaskView('signing')).toBe('queue')
  })
})
