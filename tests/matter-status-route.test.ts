import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATTER_STATUSES, matterStatusLabel } from '@/types/database'

const routePath = path.join(process.cwd(), 'app/api/admin/matters/[id]/status/route.ts')
const source = fs.readFileSync(routePath, 'utf8')

describe('matter status route', () => {
  it('requires admin auth and rejects a status outside the CHECK constraint', () => {
    expect(source).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    expect(source).toContain('const { err, userId, user } = await requireAdmin(req)')
    expect(source).toContain('VALID_STATUSES')
    expect(source).toContain("return NextResponse.json({ error: 'A valid status is required' }")
  })

  it('updates the matter and logs the transition', () => {
    expect(source).toContain("import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'")
    expect(source).toContain('.update({ status, hold_reason: holdReason })')
    expect(source).toContain("event_type: 'status_changed'")
  })

  it('only carries a hold reason while the matter is on hold', () => {
    // Leaving on_hold must not keep a stale reason; the DB trigger clears it
    // too, but the route should never send one in the first place.
    expect(source).toContain("status === 'on_hold' && typeof body?.holdReason === 'string'")
  })

  it('scopes the change to hired matters', () => {
    expect(source).toContain(".eq('relationship_status', 'hired')")
  })
})

describe('matter status vocabulary', () => {
  it('matches the values the database CHECK allows', () => {
    expect(MATTER_STATUSES.map(s => s.key)).toEqual(['active', 'on_hold', 'closed', 'archived'])
  })

  it('labels every status and falls back to the raw value', () => {
    expect(matterStatusLabel('on_hold')).toBe('On hold')
    expect(matterStatusLabel('archived')).toBe('Archived')
    expect(matterStatusLabel('something_else')).toBe('something_else')
  })

  it('is the vocabulary the migration constrains', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260824000000_matter_lifecycle_v3.sql'),
      'utf8',
    )
    for (const status of MATTER_STATUSES) {
      expect(migration).toContain(`'${status.key}'`)
    }
  })
})
