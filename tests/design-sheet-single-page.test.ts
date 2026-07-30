import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_SHEET_GROUP_IDS,
  DESIGN_SECTION_IDS,
  designSectionAnchorId,
} from '@/lib/designSheet/sectionIds'

describe('single-page design sheet anchors', () => {
  it('maps legacy section navigation onto the nine stable group anchors', () => {
    expect(Object.keys(DESIGN_SHEET_GROUP_IDS)).toHaveLength(9)
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.trustDetails)).toBe('trust')
    expect(designSectionAnchorId('trust')).toBe('trust')
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.clientInformation)).toBe('facts')
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.financialPoa)).toBe('powers-of-attorney')
  })

  it('keeps focus scrolling inside the page container', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )

    expect(page).toContain('container.scrollTop +=')
    expect(page).toContain("target.focus({ preventScroll: true })")
    expect(page).toContain('}, 1600)')
    expect(page).not.toContain('scrollIntoView')
  })

  it('removes the legacy per-section route after the cleanup phase', () => {
    expect(fs.existsSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/[sectionId]/page.tsx'),
    )).toBe(false)
  })
})
