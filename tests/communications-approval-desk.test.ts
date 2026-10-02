import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

describe('communications approval desk', () => {
  it('places pending external actions with the communications queue', () => {
    const page = source('app/admin/communications/page.tsx')
    expect(page).toContain(".eq('risk', 'external_write')")
    expect(page).toContain('Ready to send')
    expect(page).toContain('send-approvals')
    expect(page).toContain('<ApprovalInbox')
  })

  it('uses one fresh-preview confirmation surface for automation and communications', () => {
    const shared = source('app/admin/components/ApprovalInbox.tsx')
    expect(shared).toContain('Review exact change')
    expect(shared).toContain('Confirm this exact')
    expect(shared).toContain('The source changed. Prepare a new proposal before acting.')
    expect(source('app/admin/automations/page.tsx')).toContain("@/app/admin/components/ApprovalInbox")
  })
})
