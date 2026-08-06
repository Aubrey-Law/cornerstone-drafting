import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('lead assets and document management', () => {
  it('adds the shared matter People tab to leads', () => {
    const leadPage = read('app/admin/leads/[id]/page.tsx')
    const leadDetail = read('app/admin/leads/[id]/LeadDetailClient.tsx')
    const leadTabs = read('lib/leads/leadPageTabs.ts')

    expect(leadTabs).toContain("'people'")
    expect(leadPage).toContain('fetchMatterContacts(lead.matter_id)')
    expect(leadDetail).toContain('<TabsTrigger value="people">People</TabsTrigger>')
    expect(leadDetail).toContain('<MatterPeopleTab')
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
