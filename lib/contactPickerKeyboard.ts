export type ContactPickerKeyResult = {
  activeIndex: number
  open: boolean
  selectIndex: number | null
  preventDefault: boolean
}

export function contactPickerKeyAction(key: string, activeIndex: number, itemCount: number, open: boolean): ContactPickerKeyResult {
  if (key === 'Escape') return { activeIndex, open: false, selectIndex: null, preventDefault: false }
  if (itemCount === 0) return { activeIndex: 0, open, selectIndex: null, preventDefault: false }
  if (!open && (key === 'ArrowDown' || key === 'ArrowUp')) {
    return { activeIndex: key === 'ArrowDown' ? 0 : itemCount - 1, open: true, selectIndex: null, preventDefault: true }
  }
  if (!open) return { activeIndex, open, selectIndex: null, preventDefault: false }
  if (key === 'ArrowDown') return { activeIndex: Math.min(activeIndex + 1, itemCount - 1), open, selectIndex: null, preventDefault: true }
  if (key === 'ArrowUp') return { activeIndex: Math.max(activeIndex - 1, 0), open, selectIndex: null, preventDefault: true }
  if (key === 'Enter') return { activeIndex, open, selectIndex: activeIndex, preventDefault: true }
  return { activeIndex, open, selectIndex: null, preventDefault: false }
}
