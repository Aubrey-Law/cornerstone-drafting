import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routePath = path.join(process.cwd(), 'app/api/admin/matters/[id]/stage/route.ts')

describe('matter stage route', () => {
  it('requires admin auth and validates stage values', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    expect(source).toContain('const { err, userId, user } = await requireAdmin(req)')
    expect(source).toContain('VALID_STAGES')
    expect(source).toContain("return NextResponse.json({ error: 'A valid stage is required' }")
  })

  it('updates matter stage and logs activity', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain("import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'")
    expect(source).toContain(".update({ stage })")
    expect(source).toContain("event_type: 'stage_changed'")
  })
})

describe('drafting queue boundary', () => {
  it('keeps stage management on Matters and drafting actions on Drafting', () => {
    const hubSource = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/DraftingHubClient.tsx'),
      'utf8',
    )
    const tableSource = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/MatterPipelineTable.tsx'),
      'utf8',
    )
    const mattersSource = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/MattersClient.tsx'),
      'utf8',
    )

    expect(hubSource).toContain('MatterPipelineTable')
    expect(hubSource).not.toContain('MatterPipelineKanban')
    expect(tableSource).toContain('hubNextAction')
    expect(tableSource).not.toContain('updateMatterStage')
    expect(tableSource).not.toContain('<select')
    expect(mattersSource).toContain('MatterStageBoard')
  })
})
