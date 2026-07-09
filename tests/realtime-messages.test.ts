import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('realtime messages', () => {
  it('subscribes to message inserts for staff matter detail', () => {
    const hook = fs.readFileSync(path.join(process.cwd(), 'lib/messages/useMessagesRealtime.ts'), 'utf8')
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    expect(hook).toContain("table: 'messages'")
    expect(hook).toContain('matter_id=eq.')
    expect(detail).toContain('useMessagesRealtime')
  })
})
