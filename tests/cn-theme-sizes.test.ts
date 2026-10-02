import { describe, expect, it } from 'vitest'
import { cn } from '@aubrey-law/ui/utils'

describe('cn with the theme font sizes', () => {
  it('keeps a text color beside text-micro / text-compact', () => {
    // A Badge passes its own text color and callers add text-micro; plain
    // tailwind-merge read text-micro as a color and dropped the real one.
    expect(cn('bg-primary text-primary-foreground', 'text-micro')).toBe('bg-primary text-primary-foreground text-micro')
    expect(cn('text-muted-foreground', 'text-compact')).toBe('text-muted-foreground text-compact')
  })

  it('still lets a later size win over an earlier one', () => {
    expect(cn('text-sm', 'text-micro')).toBe('text-micro')
    expect(cn('text-micro', 'text-xs')).toBe('text-xs')
  })
})
