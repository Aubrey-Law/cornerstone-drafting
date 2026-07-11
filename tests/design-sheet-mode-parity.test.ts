import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design sheet mode parity', () => {
  it('uses shared acceleration and final review in Fast Entry', () => {
    const express = readFileSync('app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx', 'utf8')
    for (const component of ['DesignAccelerationBar', 'DesignFinalReview']) {
      expect(express).toContain(`<${component}`)
    }
  })

  it('owns one attorney preset source and shares updates with both consumers', () => {
    const express = readFileSync('app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx', 'utf8')
    const acceleration = readFileSync('components/design-sheet/DesignAccelerationBar.tsx', 'utf8')
    const finalReview = readFileSync('components/design-sheet/DesignFinalReview.tsx', 'utf8')

    expect(express.match(/loadPreferences\(\)/g)).toHaveLength(1)
    expect(express).toContain('attorneyPreset={attorneyPreset}')
    expect(express).toContain('onAttorneyPresetChange={setAttorneyPreset}')
    expect(acceleration).not.toContain('loadPreferences()')
    expect(acceleration).toContain('onAttorneyPresetChange(preset)')
    expect(finalReview).not.toContain('loadPreferences()')
  })
})
