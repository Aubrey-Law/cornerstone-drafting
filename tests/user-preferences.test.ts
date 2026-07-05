import { describe, expect, it } from 'vitest'
import { resolveDesignView } from '@/lib/userPreferences'

describe('resolveDesignView', () => {
  it('prefers URL param over stored preferences', () => {
    expect(resolveDesignView({
      urlView: 'express',
      storedLocal: 'guided',
      userPreference: 'guided',
      designComplete: false,
    })).toBe('express')
  })

  it('defaults incomplete matters to guided', () => {
    expect(resolveDesignView({
      urlView: null,
      storedLocal: null,
      userPreference: undefined,
      designComplete: false,
    })).toBe('guided')
  })

  it('defaults complete matters to express when no preference is set', () => {
    expect(resolveDesignView({
      urlView: null,
      storedLocal: null,
      userPreference: undefined,
      designComplete: true,
    })).toBe('express')
  })
})
