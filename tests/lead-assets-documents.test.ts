import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('lead assets and document management', () => {
  it('folds the shared matter People workspace into the lead Intake tab', () => {
    const leadPage = read('app/admin/leads/[id]/page.tsx')
    const leadDetail = read('app/admin/leads/[id]/LeadDetailClient.tsx')
    const leadTabs = read('lib/leads/leadPageTabs.ts')

    // People is no longer a tab of its own — it reads as part of Intake.
    expect(leadTabs).not.toContain("'people',")
    expect(leadTabs).toContain("people: 'intake'")
    expect(leadPage).toContain('fetchMatterContacts(lead.matter_id)')
    expect(leadDetail).not.toContain('<TabsTrigger value="people">')
    expect(leadDetail).toContain('<MatterPeopleTabContent')
    expect(leadDetail).toContain('recordLabel="lead"')
  })

  it('adds an Assets tab backed by the same asset workspace used by matters', () => {
    const leadDetail = read('app/admin/leads/[id]/LeadDetailClient.tsx')
    const leadTabs = read('lib/leads/leadPageTabs.ts')

    expect(leadTabs).toContain("'assets'")
    expect(leadDetail).toContain('<TabsTrigger value="assets">Assets</TabsTrigger>')
    expect(leadDetail).toContain('<MatterAssetsTab')
    expect(leadDetail).toContain('intakeId={liveIntakeId}')
  })

  it('gives admins the full matter document workspace on a linked lead', () => {
    const leadDocuments = read('components/leads/LeadDocumentsTab.tsx')
    const matterDocuments = read('app/admin/matters/[id]/MatterDocumentsTab.tsx')

    expect(leadDocuments).toContain('<MatterDocumentsTab')
    expect(leadDocuments).toContain('onDocumentsChanged={onDocumentsChanged}')
    expect(matterDocuments).toContain('await uploadDocument(file, matterId)')
    expect(matterDocuments).toContain('recordLabel =')
  })
})

describe('the opportunity workspace after the intake consolidation', () => {
  it('orders the tabs Intake, Assets, Tasks, Communications, Documents, Notes', () => {
    const leadTabs = read('lib/leads/leadPageTabs.ts')
    const leadDetail = read('app/admin/leads/[id]/LeadDetailClient.tsx')

    expect(leadTabs).toContain(
      "export const LEAD_TABS = ['intake', 'assets', 'tasks', 'communications', 'documents', 'notes'] as const",
    )
    // Plan and Timeline are folded into Intake, so neither has a trigger left.
    expect(leadDetail).not.toContain('<TabsTrigger value="plan">')
    expect(leadDetail).not.toContain('<TabsTrigger value="timeline">')
    // Intake is the landing tab, so it stays out of the URL like Plan did.
    expect(leadDetail).toContain("if (tab === 'intake') params.delete('tab')")

    const order = ['intake', 'assets', 'tasks', 'communications', 'documents', 'notes']
      .map(tab => leadDetail.indexOf(`<TabsTrigger value="${tab}"`))
    expect(order.every(index => index > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('reads intake, score, plan, key dates, people, and timeline in that order', () => {
    const leadDetail = read('app/admin/leads/[id]/LeadDetailClient.tsx')
    const intakeTab = leadDetail.slice(
      leadDetail.indexOf('<TabsContent value="intake"'),
      leadDetail.indexOf('<TabsContent value="tasks"'),
    )

    const order = [
      '<LeadIntakeCard',
      '<LeadScoreCard',
      '<LeadPlanTab',
      '<LeadKeyDatesCard',
      '<MatterPeopleTabContent',
      '<LeadChannelsCard',
      '{timeline}',
    ].map(marker => intakeTab.indexOf(marker))
    expect(order.every(index => index > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('moves the stage onto the rail and leaves the extra channels with the people', () => {
    const rail = read('components/leads/LeadFieldsRail.tsx')
    const leadDetail = read('app/admin/leads/[id]/LeadDetailClient.tsx')

    expect(rail).toContain('MUTABLE_LEAD_STATUS_LABEL')
    expect(rail).toContain("aria-label=\"Stage\"")
    // The quoted fee was already a rail field and stays one.
    expect(read('lib/leads/fieldDefinitions.ts')).toContain("label: 'Quoted fee'")
    // Neither the extra channels nor the SLA anchors are rail concerns now.
    expect(rail).not.toContain('ChannelListField')
    expect(rail).not.toContain('LEAD_KEY_DATE_FIELDS')
    expect(leadDetail).toContain('onStageChange={handleTopStatusChange}')
  })
})
