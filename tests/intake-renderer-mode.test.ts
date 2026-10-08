import { describe, expect, it } from 'vitest'
import { resolveIntakeRendererMode } from '@/lib/intake/forms/rendererMode'

describe('server intake renderer selection', () => {
  it.each([[undefined, 'legacy'], ['', 'legacy'], ['legacy', 'legacy'], ['compiled', 'compiled'], ['nonsense', 'legacy']] as const)('maps %s to %s', (raw, expected) => {
    expect(resolveIntakeRendererMode({ INTAKE_RENDERER_MODE: raw })).toBe(expected)
  })
})
