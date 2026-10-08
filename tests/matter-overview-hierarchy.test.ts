import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterDir = path.join(process.cwd(), 'app/admin/matters/[id]')

describe('matter overview hierarchy', () => {
  it('uses the action overview without repeating the progress timeline', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')

    expect(client).toContain('MatterOverviewWork')
    expect(client).not.toContain('MatterProgressTimeline')
    expect(client).not.toContain('MatterOverviewSummaryCards')
  })

  it('uses plain collection tab labels, keeps their workspaces mounted, and keeps Activity last', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')

    const navigation = fs.readFileSync(path.join(process.cwd(), 'lib/matters/workspace.ts'), 'utf8')
    expect(client).toContain('<MatterWorkspaceNav')
    expect(navigation).toContain("['people', 'People']")
    expect(navigation).toContain("['assets', 'Assets']")
    expect(navigation).toContain("['documents', 'Documents']")
    expect(client).toContain('documents: unreviewedUploadCounts.total')
    expect(client).not.toContain('People {contacts.length}')
    expect(client).not.toContain('Assets {initialEstateSnapshot.assetCount}')
    expect(client).not.toContain('Documents {documents.length}')
    expect(client).toContain('<MatterPeopleTab')
    expect(client).toContain('<MatterAssetsTabContent')
    expect(client).toContain('<MatterDocumentsWorkspace')
    expect(client.indexOf('value="activity"')).toBeGreaterThan(client.indexOf('value="notes"'))
  })

  it('folds the administrative fields into the facts panel and exposes persistent save state', () => {
    const adminRows = fs.readFileSync(path.join(matterDir, 'facts-panel', 'MatterAdminRows.tsx'), 'utf8')
    const detailsPanel = fs.readFileSync(path.join(matterDir, 'MatterDetailsPanel.tsx'), 'utf8')
    const saveHook = fs.readFileSync(path.join(matterDir, 'useMatterDetailsSave.ts'), 'utf8')

    expect(adminRows).toContain("{ manual: false }")
    expect(adminRows).toContain("'engagement_status'")
    expect(detailsPanel).toContain('adminRows={<MatterAdminRows')
    expect(detailsPanel).not.toContain('Administrative settings')
    expect(saveHook).toContain('savingField')
    expect(saveHook).toContain('lastSavedAt')
    expect(saveHook).toContain('error')
  })
})
