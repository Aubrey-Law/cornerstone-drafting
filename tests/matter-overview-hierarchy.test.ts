import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterDir = path.join(process.cwd(), 'app/admin/matters/[id]')

describe('matter overview hierarchy', () => {
  it('renders the progress timeline and linked count strip', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')
    const summary = fs.readFileSync(path.join(matterDir, 'MatterOverviewSummaryCards.tsx'), 'utf8')

    expect(client).toContain('MatterProgressTimeline')
    expect(summary).toContain('People')
    expect(summary).toContain('Tasks')
    expect(summary).not.toContain('function SummaryCard')
  })

  it('shows counts on collection tabs and keeps Activity last', () => {
    const client = fs.readFileSync(path.join(matterDir, 'MatterDetailClient.tsx'), 'utf8')

    expect(client).toContain('People {contacts.length}')
    expect(client).toContain('Assets {initialEstateSnapshot.assetCount}')
    expect(client).toContain('Documents {documents.length}')
    expect(client.indexOf('value="activity"')).toBeGreaterThan(client.indexOf('value="notes"'))
  })

  it('uses read-first editable panels and exposes persistent save state', () => {
    const essentials = fs.readFileSync(path.join(matterDir, 'MatterEssentialsCard.tsx'), 'utf8')
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
