import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const source = read('app/api/admin/leads/[id]/engagement-draft/route.ts')
const resumable = read('lib/engagement/resumableDraft.ts')

describe('lead engagement draft route', () => {
  it('only resumes workspace-loadable draft agreements', () => {
    expect(source).toContain('findResumableEngagementDraft(admin, opportunity.id)')
    expect(source).toContain('createAgreementDraft')
    expect(resumable).toContain('isSupportedWorkspaceDefinition')
    expect(resumable).toContain("not('active_revision_id', 'is', null)")
    expect(resumable).toContain("from('engagement_agreement_revisions')")
  })

  it('seeds a probate lead from its intake decedent and checks the shared-email couple', () => {
    expect(source).toContain('probate.decedent_name')
    expect(source).toContain('primaryEmail,')
    expect(source).toContain("seed.definition.clientMode === 'couple'")
  })

  it('resumes the same draft from the matter route', () => {
    expect(read('app/api/admin/matters/[id]/engagement-draft/route.ts')).toContain('findResumableEngagementDraft(admin, matterId)')
  })
})
