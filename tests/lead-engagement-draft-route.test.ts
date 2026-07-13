import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/leads/[id]/engagement-draft/route.ts'),
  'utf8',
)

describe('lead engagement draft route', () => {
  it('only resumes workspace-loadable draft agreements', () => {
    expect(source).toContain('isSupportedWorkspaceDefinition')
    expect(source).toContain('active_revision_id')
    expect(source).toContain("from('engagement_agreement_revisions')")
    expect(source).toContain('canOpenWorkspace(existing')
    expect(source).toContain('createAgreementDraft')
  })
})
