import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('matter activity timeline', () => {
  it('adds activity tab to matter detail', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/page.tsx'), 'utf8')
    const tab = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterActivityTab.tsx'), 'utf8')
    expect(detail).toContain('MatterActivityTab')
    expect(page).toContain("from('matter_activity')")
    expect(detail).not.toContain("from('matter_activity')")
    expect(tab).toContain('intake_sent')
  })
})
