import { describe, expect, it } from 'vitest'
import { dockClausePreview } from '@/lib/designSheet/workspaceLayout'
describe('design workspace clause layout', () => {
  it('uses a drawer where both rails would squeeze the form', () => {
    expect(dockClausePreview(1024, true)).toBe(false)
    expect(dockClausePreview(768, false)).toBe(false)
    expect(dockClausePreview(1024, false)).toBe(true)
    expect(dockClausePreview(1280, true)).toBe(true)
  })
})
