import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/**
 * A lead is a matter that nobody has signed yet, so the matter page has to be
 * able to work one. These pin the pieces that made that impossible.
 */

describe('matter page knows it is showing a lead', () => {
  const page = read('app/admin/matters/[id]/page.tsx')

  it('loads relationship_status in both shell column sets', () => {
    // Without it the page cannot tell a lead from a hired matter at all, so no
    // lifecycle action can be gated on it.
    expect(page).toContain("MATTER_SHELL_COLUMNS_FULL = 'client_intake_id, relationship_status")
    expect(page).toContain("MATTER_SHELL_COLUMNS_BASE = 'client_intake_id, relationship_status")
  })

  it('defaults rows with no lifecycle value to hired', () => {
    expect(page).toContain("(matterRow?.relationship_status as string | null) ?? 'hired'")
  })
})

describe('engagement routes reach leads', () => {
  it('reads the consolidated view, not the hired-only one', () => {
    // An engagement is sent to a lead, so the hired-only view found nothing for
    // exactly the matters these routes exist to serve.
    for (const route of [
      'app/api/admin/matters/[id]/engagement/route.ts',
      'app/api/admin/matters/[id]/engagement-draft/route.ts',
    ]) {
      const source = read(route)
      expect(source, route).toContain("from('v_matter_pipeline_all')")
      expect(source, route).not.toContain("from('v_matter_pipeline')")
    }
  })

  it('intake send accepts a lead matter', () => {
    const source = read('app/api/admin/intake/send/route.ts')
    // It reads `matters` directly with no lifecycle filter, which is what makes
    // sending an intake from a lead's matter page work.
    expect(source).toContain("from('matters')")
    expect(source).not.toContain("relationship_status")
  })
})

describe('lead lifecycle actions on the matter page', () => {
  const actions = read('app/admin/matters/[id]/MatterLeadActions.tsx')
  const client = read('app/admin/matters/[id]/MatterDetailClient.tsx')

  it('renders nothing once the matter is hired', () => {
    expect(actions).toContain("if (relationshipStatus === 'hired') return null")
  })

  it('offers hire, lost and decline while it is a lead', () => {
    expect(actions).toContain('Hire matter')
    expect(actions).toContain("onStatusChange('lost')")
    expect(actions).toContain("onStatusChange('declined')")
  })

  it('offers reactivate from either closed state', () => {
    expect(actions).toContain("relationshipStatus === 'lost' || relationshipStatus === 'declined'")
    expect(actions).toContain("onStatusChange('lead')")
  })

  it('hires through the convert endpoint rather than a status write', () => {
    // Hiring assigns the matter number and starts the firm clock; a plain
    // status write would do neither.
    expect(client).toContain('/convert')
    expect(client).toContain('Could not hire this matter')
  })

  it('keys the lead endpoints off the intake id', () => {
    expect(client).toContain('`/api/admin/leads/${liveIntakeId}/convert`')
    expect(client).toContain('`/api/admin/leads/${liveIntakeId}`')
  })

  it('disables every action without an intake row to act on', () => {
    expect(actions).toContain('disabled={busy || !intakeId}')
  })
})
