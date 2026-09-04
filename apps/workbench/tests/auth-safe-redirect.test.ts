import { describe, expect, it } from 'vitest'
import { safeRedirectForRole } from '@/lib/auth/gate'

describe('safeRedirectForRole', () => {
  it('allows a staff path for staff', () => {
    expect(safeRedirectForRole('/matters/abc?tab=documents', 'attorney')).toBe('/matters/abc?tab=documents')
  })

  it('allows a portal path for a client', () => {
    expect(safeRedirectForRole('/portal/documents', 'client')).toBe('/portal/documents')
  })

  it.each([
    ['//evil.example/path', 'protocol-relative URL'],
    ['https://evil.example', 'absolute URL'],
    ['/portal', 'the other audience'],
    ['', 'empty'],
    ['matters', 'no leading slash'],
  ])('rejects %s (%s) for staff', (value) => {
    expect(safeRedirectForRole(value, 'attorney')).toBeNull()
  })

  it('rejects everything for a role with no home', () => {
    expect(safeRedirectForRole('/matters', null)).toBeNull()
  })

  it('keeps the query and hash of an allowed path', () => {
    expect(safeRedirectForRole('/tasks?due=today#first', 'admin')).toBe('/tasks?due=today#first')
  })

  it('rejects a backslash-prefixed path some browsers normalise to //', () => {
    expect(safeRedirectForRole('/\\evil.example', 'attorney')).toBeNull()
  })
})
