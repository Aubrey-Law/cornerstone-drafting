import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('design sheet delete pass', () => {
  it('removes superseded guided and per-section surfaces', () => {
    for (const relativePath of [
      'app/admin/drafting/[matterId]/design/DesignSectionOverview.tsx',
      'app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx',
      'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx',
      'app/admin/drafting/[matterId]/design/[sectionId]/page.tsx',
      'components/guided/DesignSummaryRail.tsx',
      'components/guided/SectionProgressList.tsx',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(false)
    }
  })

  it('keeps ExpressDesignSheet only as a single-page compatibility alias', () => {
    const express = fs.readFileSync(
      path.join(root, 'app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx'),
      'utf8',
    )
    expect(express).toContain("export { default } from './DesignSheetPage'")
  })

  it('keeps the acceleration control limited to shortcuts', () => {
    const acceleration = fs.readFileSync(
      path.join(root, 'components/design-sheet/DesignAccelerationBar.tsx'),
      'utf8',
    )
    expect(acceleration).toContain('Shortcuts')
    expect(acceleration).not.toContain('Next required')
    expect(acceleration).not.toContain('showLayoutControls')
  })
})
