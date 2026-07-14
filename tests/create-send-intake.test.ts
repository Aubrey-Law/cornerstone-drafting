import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('create and send intake wizard', () => {
  it('chains create matter with optional intake send', () => {
    const matters = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/MattersClient.tsx'), 'utf8')
    expect(matters).toContain('sendIntakeOnCreate')
    expect(matters).toContain('/api/admin/intake/send')
    expect(matters).toContain('createdIntakeUrl')
    expect(matters).toContain("searchParams.get('create') === '1'")
  })

  it('removes stale intake send 404 branch from matter detail', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    expect(detail).not.toContain('Intake send is not available yet')
  })

  it('keeps matter import and update controls after lead intake moves upstream', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    expect(detail).toContain('Import intake — paste text or upload Word')
    expect(detail).toContain('Update intake')
    expect(detail).toContain('ImportIntakeDialog')
  })
})
