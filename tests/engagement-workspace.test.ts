import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('engagement workspace slice', () => {
  it('has stable URL-backed drafting-style navigation', () => {
    const source = read('components/engagement/EngagementWorkspace.tsx')
    for (const step of ['design', 'generate', 'review']) expect(source).toContain(`'${step}'`)
    expect(source).toContain('searchParams')
    expect(source).toContain('router.replace')
  })

  it('maps legacy engagement step URLs into the drafting-style flow', () => {
    const source = read('components/engagement/workspaceState.ts')

    expect(source).toContain("value === 'details' || value === 'terms'")
    expect(source).toContain("return 'design'")
    expect(source).toContain("value === 'send' || value === 'status'")
    expect(source).toContain("return 'review'")
  })

  it('keeps editing structured and requires exact send confirmation', () => {
    const source = read('components/engagement/EngagementWorkspace.tsx')
    expect(source).toContain('Estate Planning')
    expect(source).toContain('Couple')
    expect(source).toContain('approvalToken')
    expect(source).toContain('confirmExactRevision')
    expect(source).toContain('GenerateStep')
    expect(source).toContain('ReviewStep')
    expect(source).not.toContain('contentEditable')
  })

  it('routes authorize staff, fail closed, and delegate preview/approval/send to the service', () => {
    for (const suffix of ['route.ts', 'preview/route.ts', 'approve/route.ts', 'send/route.ts']) {
      const source = read(`app/api/admin/engagement-agreements/[id]/${suffix}`)
      expect(source).toContain('requireEngagementStaff')
      expect(source).toContain('getScopedAgreement')
    }
    expect(read('app/api/admin/engagement-agreements/[id]/preview/route.ts')).toContain('previewAgreement')
    expect(read('app/api/admin/engagement-agreements/[id]/approve/route.ts')).toContain('approveAgreementRevision')
    expect(read('app/api/admin/engagement-agreements/[id]/send/route.ts')).toContain('sendApprovedAgreement')
    expect(read('app/api/admin/engagement-agreements/[id]/send/route.ts')).toContain('confirmExactRevision')
  })
})
