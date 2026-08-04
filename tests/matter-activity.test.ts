import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('matter activity timeline', () => {
  it('adds activity tab to matter detail', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/page.tsx'), 'utf8')
    // Event icons/labels live in the shared module both activity surfaces read.
    const meta = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/activityEventMeta.tsx'), 'utf8')
    expect(detail).toContain('MatterActivityTab')
    expect(page).toContain("from('matter_activity')")
    expect(detail).not.toContain("from('matter_activity')")
    expect(meta).toContain('intake_sent')
  })
})
