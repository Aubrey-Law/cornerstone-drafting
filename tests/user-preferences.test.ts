import { describe, expect, it } from 'vitest'
import { parseUserPreferences, resolveDesignView } from '@/lib/userPreferences'

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

  it('defaults matters with intake data to express when no preference is set', () => {
    expect(resolveDesignView({
      urlView: null,
      storedLocal: null,
      userPreference: undefined,
      designComplete: false,
      hasIntake: true,
    })).toBe('express')
  })

  it('parses only versioned allowlisted attorney preset fields', () => {
    expect(parseUserPreferences({
      drafting: {
        attorneyPreset: {
          version: 1,
          fields: {
            bond: 'no_bond',
            supervision: 'unsupervised',
            client_name: 'do not keep',
            hipaa_psychotherapy_notes: 'include',
          },
        },
      },
    }).drafting?.attorneyPreset).toEqual({
      version: 1,
      fields: { bond: 'no_bond', supervision: 'unsupervised' },
    })
  })
})
