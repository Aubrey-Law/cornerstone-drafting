import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterDir = path.join(process.cwd(), 'app/admin/matters/[id]')

describe('matter overview hierarchy', () => {
  it('renders the progress timeline without a top-level count strip', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')

    expect(client).toContain('MatterProgressTimeline')
    expect(client).not.toContain('MatterOverviewSummaryCards')
  })

  it('uses plain collection tab labels, keeps their workspaces mounted, and keeps Activity last', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')

    expect(client).toContain('>People</TabsTrigger>')
    expect(client).toContain('>Assets</TabsTrigger>')
    expect(client).toContain('>People</TabsTrigger>')
    expect(client).toMatch(/Documents\s*\n\s*\{unreviewedUploadCounts\.total > 0/)
    expect(client).not.toContain('People {contacts.length}')
    expect(client).not.toContain('Assets {initialEstateSnapshot.assetCount}')
    expect(client).not.toContain('Documents {documents.length}')
    expect(client).toContain('<MatterPeopleTab')
    expect(client).toContain('<MatterAssetsTabContent')
    expect(client).toContain('<MatterDocumentsTab')
    expect(client.indexOf('value="activity"')).toBeGreaterThan(client.indexOf('value="notes"'))
  })

  it('uses read-first editable panels and exposes persistent save state', () => {
    const essentials = fs.readFileSync(path.join(matterDir, 'MatterDetailsCard.tsx'), 'utf8')
    const saveHook = fs.readFileSync(path.join(matterDir, 'useMatterDetailsSave.ts'), 'utf8')

    expect(essentials).toContain('ReadFirstPanel')
    expect(essentials).toContain('fee_payment_status')
    expect(essentials).toContain('normalizeTargetSigningDate')
    expect(essentials).toContain("{ manual: false }")
    expect(saveHook).toContain('savingField')
    expect(saveHook).toContain('lastSavedAt')
    expect(saveHook).toContain('error')
  })
})
