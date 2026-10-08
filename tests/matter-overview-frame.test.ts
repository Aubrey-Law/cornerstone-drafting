import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routeDir = path.join(process.cwd(), 'app/admin/matters/[id]')

describe('matter overview frame', () => {
  it('loads full stage-aging context and server-derived estate facts', () => {
    const query = fs.readFileSync(path.join(process.cwd(), 'lib/queries/matterOverview.ts'), 'utf8')
    const page = fs.readFileSync(path.join(routeDir, 'page.tsx'), 'utf8')

    expect(query).toContain('fetchMatterAgingSummary')
    expect(query).toContain('days_in_stage')
    expect(page).toContain('fetchMatterEstateSnapshot')
    expect(page).toContain('initialEstateSnapshot')
  })

  it('retains intake operations while keeping stage changes in the progress strip', () => {
    const header = fs.readFileSync(path.join(routeDir, 'MatterDetailHeader.tsx'), 'utf8')
    const hero = fs.readFileSync(path.join(routeDir, 'MatterOverviewHero.tsx'), 'utf8')
    const stageStrip = fs.readFileSync(path.join(routeDir, 'MatterStageStrip.tsx'), 'utf8')

    expect(header).toContain('Matter actions')
    expect(header).toContain('Import intake — paste text or upload Word')
    expect(header).toContain('Unlock intake for client editing')
    expect(header).not.toContain('aria-label="Matter stage"')
    expect(stageStrip).toContain('Change stage')
    expect(stageStrip).toContain('Confirm stage change')
    expect(hero).not.toContain('Matter Status: Hired')
    expect(hero).not.toContain('Aging {agingHealth}')
  })

  it('uses the full available admin content width with shared workspace edges', () => {
    const client = fs.readFileSync(path.join(routeDir, 'MatterDetailClient.tsx'), 'utf8')

    expect(client).not.toContain('max-w-[1280px]')
    expect(client).toContain('className="w-full gap-4"')
    expect(client).not.toContain('className="mx-auto w-full max-w-6xl gap-4"')
  })

  it('composes stage and navigation into the header and docks details on the right', () => {
    const client = fs.readFileSync(path.join(routeDir, 'MatterDetailClient.tsx'), 'utf8')

    expect(client).toContain('stage={')
    expect(client).toContain('navigation={<MatterWorkspaceNav')
    expect(client).toContain('side="right"')
    expect(client).toContain('collapseBelow="lg"')
    expect(client).not.toContain('<ResponsiveDetailRail\n          drawer')
    expect(client.indexOf('<ResponsiveDetailRail')).toBeGreaterThan(client.indexOf('<div className="flex min-w-0 flex-1 flex-col overflow-y-auto">'))
  })
})
