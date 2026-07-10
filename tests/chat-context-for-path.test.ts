import { describe, expect, it } from 'vitest'

import { chatContextForPath } from '@/app/admin/components/useChatContext'

describe('chatContextForPath', () => {
  it('scopes to the matter on a matter detail page', () => {
    expect(chatContextForPath('/admin/matters/abc-123')).toEqual({
      type: 'matter', id: 'abc-123', label: 'This matter',
    })
  })

  it('scopes to the matter on the drafting / design-sheet workspace', () => {
    expect(chatContextForPath('/admin/drafting/abc-123')).toEqual({
      type: 'matter', id: 'abc-123', label: 'This matter',
    })
    expect(chatContextForPath('/admin/drafting/abc-123?step=design')).toEqual({
      type: 'matter', id: 'abc-123', label: 'This matter',
    })
  })

  it('falls back to general elsewhere, including the drafting hub', () => {
    expect(chatContextForPath('/admin/drafting')).toEqual({ type: 'general' })
    expect(chatContextForPath('/admin/matters')).toEqual({ type: 'general' })
    expect(chatContextForPath('/admin/settings')).toEqual({ type: 'general' })
  })
})
