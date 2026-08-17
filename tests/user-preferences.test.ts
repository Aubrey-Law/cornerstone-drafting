import { describe, expect, it } from 'vitest'
import {
  parseUserPreferences,
  resolveClausePreviewOpen,
  resolveDesignView,
  resolveSinglePageDesignSheet,
} from '@/lib/userPreferences'

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

  it('defaults the single-page design sheet off and preserves an explicit opt-in', () => {
    expect(resolveSinglePageDesignSheet(parseUserPreferences({}))).toBe(false)
    expect(resolveSinglePageDesignSheet(parseUserPreferences({
      drafting: { singlePageDesignSheet: true },
    }))).toBe(true)
    expect(resolveSinglePageDesignSheet(parseUserPreferences({
      drafting: { singlePageDesignSheet: 'true' },
    }))).toBe(false)
  })

  it('defaults the clause preview open and preserves an explicit dismissal', () => {
    expect(resolveClausePreviewOpen(parseUserPreferences({}))).toBe(true)
    expect(resolveClausePreviewOpen(parseUserPreferences({
      drafting: { clausePreviewOpen: false },
    }))).toBe(false)
  })
})

/**
 * Widening the preset to v2 briefly made the parser reject every v1 preset
 * already stored, which silently retired standards attorneys had saved — the
 * apply path accepted v1 fine, but nothing ever reached it.
 */
describe('attorney presets saved before decisions existed', () => {
  it('keeps reading a v1 preset', () => {
    expect(parseUserPreferences({
      drafting: { attorneyPreset: { version: 1, fields: { bond: 'no_bond' } } },
    }).drafting?.attorneyPreset).toEqual({ version: 1, fields: { bond: 'no_bond' } })
  })

  it('reads a v2 preset with its decision provisions', () => {
    expect(parseUserPreferences({
      drafting: {
        attorneyPreset: {
          version: 2,
          fields: { bond: 'no_bond' },
          decisions: {
            'dpoa_provisions.coagent_serving': 'separately',
            'trust_details.residual_beneficiary_method': 'staggered',
          },
        },
      },
    }).drafting?.attorneyPreset).toEqual({
      version: 2,
      fields: { bond: 'no_bond' },
      // residual_beneficiary_method is a client election, not a firm standard,
      // so it is not on the preset allowlist and is dropped.
      decisions: { 'dpoa_provisions.coagent_serving': 'separately' },
    })
  })

  it('still rejects a version it does not know', () => {
    expect(parseUserPreferences({
      drafting: { attorneyPreset: { version: 99, fields: { bond: 'no_bond' } } },
    }).drafting?.attorneyPreset).toBeUndefined()
  })
})
