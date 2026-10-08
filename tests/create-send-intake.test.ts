import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('create and send intake wizard', () => {
  it('creates hired matters without sending another intake invitation', () => {
    const matters = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/MattersClient.tsx'), 'utf8')
    expect(matters).not.toContain('sendIntakeOnCreate')
    expect(matters).not.toContain('/api/admin/intake/send')
    expect(matters).toContain('Open matter')
    expect(matters).toContain("searchParams.get('create') === '1'")
  })

  it('removes stale intake send 404 branch from matter detail', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    expect(detail).not.toContain('Intake send is not available yet')
  })

  it('keeps matter import and update controls after lead intake moves upstream', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    const header = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailHeader.tsx'), 'utf8')
    expect(header).toContain('Import intake — paste text or upload Word')
    expect(header).toContain('Review / update intake')
    expect(detail).toContain('ImportIntakeDialog')
  })
})
