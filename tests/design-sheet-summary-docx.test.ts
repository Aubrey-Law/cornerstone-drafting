import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import {
  buildDesignSummaryDocx,
  buildDesignSummarySections,
} from '@/lib/designSheet/summaryDocx'
import type { DesignSheet } from '@/types/database'

const CONTEXT = {
  clientName: 'Jie Chen',
  spouseName: 'Zilong Wang',
  matterNumber: 'EP-2026-14',
  exportedOn: '2026-10-07',
}

const sheet = {
  client_name: 'Jie Chen',
  marital_status: 'married',
  is_joint: true,
  children: [{ id: 'x', name: 'Mei Chen', dob: '2010-01-01' }],
  decisions: {},
} as unknown as DesignSheet

describe('internal design summary docx', () => {
  it('lists answered and unanswered questions', () => {
    const sections = buildDesignSummarySections(sheet)
    const rows = sections.flatMap(s => s.rows)
    expect(rows.find(r => r.question === 'Client name')?.answer).toEqual(['Jie Chen'])
    expect(rows.find(r => r.question === 'Marital status')?.answer).toEqual(['Married'])
    expect(rows.find(r => r.question === 'Client phone')?.answer).toEqual([])
    const children = rows.find(r => r.question === 'Children')?.answer ?? []
    expect(children).toHaveLength(1)
    expect(children[0]).toContain('Mei Chen')
    expect(children[0]).not.toContain('x,')
  })

  it('produces a valid Word file with the unanswered marker', async () => {
    const buffer = await buildDesignSummaryDocx(sheet, CONTEXT)
    const xml = new PizZip(buffer).file('word/document.xml')!.asText()
    expect(xml).toContain('Design Sheet Summary')
    expect(xml).toContain('INTERNAL')
    expect(xml).toContain('Not answered')
    expect(xml).toContain('Jie Chen')
  })

  it('is wired into the export route, hook and toolbar', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
    expect(read('app/api/admin/matters/[id]/design-sheet/export/route.ts')).toContain("format === 'summary'")
    expect(read('lib/designSheet/useDesignSheetState.ts')).toContain("exportDesignSheet('summary')")
    expect(read('components/guided/DesignToolbarActions.tsx')).toContain('Export internal summary (.docx)')
    expect(read('app/admin/drafting/[matterId]/design/DesignSheetPage.tsx')).toContain('onExportSummary={handleExportSummary}')
  })
})
