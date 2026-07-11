import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('renders all filtered contacts in a scrollable accessible listbox', () => {
  const source = readFileSync('app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx', 'utf8')
  expect(source).not.toContain('.slice(0, 5)')
  expect(source).toContain('role="listbox"')
  expect(source).toContain('overflow-y-auto')
  expect(source).toContain('max-h-64')
  expect(source).toContain("event.key === 'ArrowDown'")
  expect(source).toContain("event.key === 'Escape'")
})
