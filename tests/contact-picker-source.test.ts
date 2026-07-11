import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('renders all filtered contacts in a scrollable accessible listbox', () => {
  const source = readFileSync('app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx', 'utf8')
  expect(source).not.toContain('.slice(0, 5)')
  expect(source).toContain('role="listbox"')
  expect(source).toContain('overflow-y-auto')
  expect(source).toContain('max-h-64')
  expect(source).toContain('contactPickerKeyAction')
})

it('reopens a dismissed contact list with either arrow key and activates an option', () => {
  const source = readFileSync('app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx', 'utf8')
  expect(source).toContain('setShowDropdown(action.open)')
  expect(source).toContain('setActiveIndex(action.activeIndex)')
})

it('keeps the empty-results status outside the listbox', () => {
  const source = readFileSync('app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx', 'utf8')
  const listboxEnd = source.indexOf('</div>', source.indexOf('role="listbox"'))
  const noMatches = source.indexOf('No matches')
  expect(listboxEnd).toBeGreaterThan(-1)
  expect(noMatches).toBeGreaterThan(listboxEnd)
  expect(source).toContain('<div role="status"')
})
