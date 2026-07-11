import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design sheet mode parity', () => {
  it('uses shared acceleration and final review in Fast Entry', () => {
    const express = readFileSync('app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx', 'utf8')
    const guided = readFileSync('app/admin/drafting/[matterId]/design/DesignSheetShell.tsx', 'utf8')
    for (const source of [express, guided]) {
      for (const component of ['DesignAccelerationBar', 'DesignFinalReview']) {
        expect(source).toContain(`<${component}`)
      }
    }
  })

  it('owns one attorney preset source and shares updates with both consumers', () => {
    const express = readFileSync('app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx', 'utf8')
    const acceleration = readFileSync('components/design-sheet/DesignAccelerationBar.tsx', 'utf8')
    const finalReview = readFileSync('components/design-sheet/DesignFinalReview.tsx', 'utf8')

    expect(express.match(/loadPreferences\(\)/g)).toHaveLength(1)
    expect(express).toContain('attorneyPreset={attorneyPreset}')
    expect(express).toContain('const attorneyPresetVersionRef = useRef(0)')
    expect(express).toContain('const loadVersion = attorneyPresetVersionRef.current')
    expect(express).toContain('attorneyPresetVersionRef.current === loadVersion')
    expect(express).toContain('attorneyPresetVersionRef.current += 1')
    expect(express).toContain('onAttorneyPresetChange={handleAttorneyPresetChange}')
    expect(acceleration).not.toContain('loadPreferences()')
    expect(acceleration).toContain('onAttorneyPresetChange(preset)')
    expect(finalReview).not.toContain('loadPreferences()')
  })

  it('owns one Guided attorney preset source and guards async loads from local saves', () => {
    const guided = readFileSync('app/admin/drafting/[matterId]/design/DesignSheetShell.tsx', 'utf8')

    expect(guided.match(/loadPreferences\(\)/g)).toHaveLength(1)
    expect(guided).toContain('attorneyPreset={attorneyPreset}')
    expect(guided).toContain('const attorneyPresetVersionRef = useRef(0)')
    expect(guided).toContain('const loadVersion = attorneyPresetVersionRef.current')
    expect(guided).toContain('attorneyPresetVersionRef.current === loadVersion')
    expect(guided).toContain('attorneyPresetVersionRef.current += 1')
    expect(guided).toContain('onAttorneyPresetChange={handleAttorneyPresetChange}')
  })

  it('preserves section-by-section scroll position across field updates', () => {
    const pageView = readFileSync('app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx', 'utf8')
    const guided = readFileSync('app/admin/drafting/[matterId]/design/DesignSheetShell.tsx', 'utf8')

    expect(pageView).toContain('const scrollTopRef = useRef(0)')
    expect(pageView).toContain('scrollContainer.scrollTop = scrollTopRef.current')
    expect(pageView).toContain('scrollTopRef.current = event.currentTarget.scrollTop')
    expect(guided).toContain('const pageScrollTopRef = useRef(0)')
    expect(guided).toContain('pageScrollContainer.scrollTop = pageScrollTopRef.current')
    expect(guided).toContain('pageScrollTopRef.current = event.currentTarget.scrollTop')
  })
})
