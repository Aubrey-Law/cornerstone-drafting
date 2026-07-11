import { describe, expect, it } from 'vitest'
import { contactPickerKeyAction } from '@/lib/contactPickerKeyboard'

describe('contact picker keyboard navigation', () => {
  it('opens at the appropriate edge and clamps arrow navigation', () => {
    expect(contactPickerKeyAction('ArrowUp', 0, 3, false)).toMatchObject({ open: true, activeIndex: 2, preventDefault: true })
    expect(contactPickerKeyAction('ArrowDown', 2, 3, true)).toMatchObject({ activeIndex: 2 })
  })

  it('selects the active option with Enter and closes with Escape', () => {
    expect(contactPickerKeyAction('Enter', 1, 3, true)).toMatchObject({ selectIndex: 1, preventDefault: true })
    expect(contactPickerKeyAction('Escape', 1, 3, true)).toMatchObject({ open: false })
  })
})
