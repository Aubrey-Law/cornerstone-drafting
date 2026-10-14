import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIFECYCLE_DESIGN_SHEET_COLUMNS } from '@/lib/lifecycle/server'

describe('area open performance', () => {
  it('loads only the design-sheet columns the work queue resolves', () => {
    const columns = LIFECYCLE_DESIGN_SHEET_COLUMNS.split(', ')
    expect(columns).toEqual(expect.arrayContaining([
      'matter_id',
      'status',
      'intake_review_flags',
      'decisions',
      'trustee_slots',
      'children',
      'marital_status',
    ]))
    expect(columns).not.toContain('assets')
    expect(columns).not.toContain('goals_notes')
    expect(columns).not.toContain('specific_bequests')
    expect(columns).not.toContain('drafting_notes')
  })

  it('counts aging tiles instead of downloading the board', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/queries/pipelineAging.ts'), 'utf8')
    const start = source.indexOf('export async function fetchMatterAgingTiles')
    const body = source.slice(start, source.indexOf('\nexport ', start + 1))
    expect(body).toContain("head: true")
    expect(body).not.toContain('fetchMatterAging()')
  })

  it('reuses the work graph between area opens and drops it when badges are cleared', () => {
    const graph = fs.readFileSync(path.join(process.cwd(), 'lib/work/server.ts'), 'utf8')
    const badges = fs.readFileSync(path.join(process.cwd(), 'lib/sidebarCountsInvalidation.ts'), 'utf8')
    expect(graph).toContain('cachedRead(')
    expect(badges).toContain('invalidateWorkGraphCache()')
  })

  it('starts the design-sheet pass as soon as the matter ids exist', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/queries/today.ts'), 'utf8')
    expect(source).toContain('const lifecyclePromise = mattersPromise.then')
    expect(source).not.toContain('await loadMatterLifecycleEvidenceBatch')
  })
})
