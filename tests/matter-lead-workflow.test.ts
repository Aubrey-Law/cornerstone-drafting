import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('lead and matter workspaces stay lifecycle-specific', () => {
  it('loads only hired rows on the matters list', () => {
    const query = read('lib/queries/matters.ts')
    const client = read('app/admin/matters/MattersClient.tsx')
    expect(query).toContain(".from('v_matter_pipeline')")
    expect(query).not.toContain(".from('v_matter_pipeline_all')")
    expect(client).not.toContain('Open · Leads + hired')
    expect(client).not.toContain('Filter by lifecycle')
  })

  it('exposes the matter-owned plan from the lead workspace', () => {
    // The plan is the Tasks tab's second view now, not a tab of its own, and it
    // still hangs off the `matters` row the opportunity owns.
    const tabs = read('lib/leads/leadPageTabs.ts')
    const leadClient = read('app/admin/leads/[id]/LeadDetailClient.tsx')
    expect(tabs).not.toContain("'sla',")
    expect(tabs).toContain('sla: \'tasks\'')
    expect(leadClient).toContain('planMatterId={lead.matter_id ?? null}')
    expect(leadClient).toContain('onViewChange={changeTaskView}')
  })

  it('does not expose lead lifecycle actions on matter detail', () => {
    const client = read('app/admin/matters/[id]/MatterDetailClient.tsx')
    expect(client).not.toContain('MatterLeadActions')
    expect(client).not.toContain('handleLeadStatusChange')
    expect(client).not.toContain('Could not hire this matter')
  })
})

describe('engagement routes reach leads', () => {
  it('reads the consolidated view, not the hired-only one', () => {
    // An engagement is sent to a lead, so the hired-only view found nothing for
    // exactly the matters these routes exist to serve.
    for (const route of [
      'app/api/admin/matters/[id]/engagement/route.ts',
      'app/api/admin/matters/[id]/engagement-draft/route.ts',
    ]) {
      const source = read(route)
      expect(source, route).toContain("from('v_matter_pipeline_all')")
      expect(source, route).not.toContain("from('v_matter_pipeline')")
    }
  })

  it('intake send accepts a lead matter', () => {
    const source = read('app/api/admin/intake/send/route.ts')
    // The lead workspace sends through the shared matter-owned intake route.
    expect(source).toContain("from('matters')")
    expect(source).not.toContain("relationship_status")
  })
})
