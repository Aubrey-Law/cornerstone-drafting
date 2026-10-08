import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/matters/[id]/sla-anchors/route.ts'),
  'utf8',
)

describe('SLA anchors route', () => {
  it('requires admin auth and resolves the matter', () => {
    expect(source).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    expect(source).toContain('const { err, userId, user } = await requireAdmin(req)')
    expect(source).toContain("import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'")
  })

  it('rejects anything that is not a calendar date', () => {
    // A timestamp or a half-typed date would silently become an invalid anchor
    // and date the whole plan wrong.
    expect(source).toContain('isDateKey(raw)')
    expect(source).toContain('must be a date (YYYY-MM-DD) or null')
  })

  it('reschedules the tasks waiting on each anchor it sets', () => {
    // The point of the route: recording the date and dating the tasks are one
    // action. Saving without replaying leaves the plan looking unchanged.
    expect(source).toContain('applySlaAnchor(admin, matterId, anchor, date)')
    expect(source).toContain('anchorsToApply.push')
  })

  it('maps each field to the clock it feeds', () => {
    expect(source).toContain("discoveryCallAt: { column: 'discovery_call_at', anchor: 'discovery_call'")
    expect(source).toContain("pmpsAt: { column: 'pmps_at', anchor: 'pmps'")
    expect(source).toContain("engagementSignedAt: { column: 'engagement_signed_at', anchor: 'engagement'")
    // Recommendations sent drives nudge policy, not any task's offsets.
    expect(source).toContain("recommendationsSentAt: { column: 'recommendations_sent_at', anchor: null }")
  })

  it('constrains the fit decision to the values the CHECK allows', () => {
    expect(source).toContain("const FIT_DECISIONS = ['fit', 'not_a_fit'] as const")
    expect(source).toContain('fitDecision must be fit, not_a_fit or null')
    // Deciding stamps when, so the gate has an audit trail.
    expect(source).toContain('patch.fit_decided_at = new Date().toISOString()')
  })

  it('creates the Statular client only when the matter is marked a fit', () => {
    // Statular cannot delete records, so a not-a-fit lead must never reach it.
    expect(source).toContain("if (patch.fit_decision === 'fit') {")
    expect(source).toContain('await enqueueStatularClientForFitMatter(matterId)')
    // A failed enqueue never undoes the saved decision or logs provider detail.
    expect(source).toContain("console.error('[sla-anchors] statular enqueue failed', matterId, 'enqueue_failed')")
  })

  it('clears a date without treating the blank as invalid', () => {
    expect(source).toContain("if (raw === null || raw === '')")
  })

  it('writes the change to the matter timeline', () => {
    expect(source).toContain("event_type: 'sla_anchor_set'")
  })
})

describe('plan view key dates', () => {
  const tab = fs.readFileSync(
    path.join(process.cwd(), 'components/tasks/TaskPlanView.tsx'),
    'utf8',
  )

  it('keeps the shared anchors and lead fit decision available', () => {
    const tab = fs.readFileSync(path.join(process.cwd(), 'components/tasks/KeyDatesCard.tsx'), 'utf8')
    for (const key of ['discoveryCallAt', 'pmpsAt', 'recommendationsSentAt', 'engagementSignedAt']) {
      expect(tab, key).toContain(`key: '${key}'`)
    }
    expect(tab).toContain('aria-label="Fit decision"')
  })

  it('reloads the plan after saving, since the due dates just moved', () => {
    expect(tab).toContain('await load()')
  })
})

describe('tasks route exposes the anchors', () => {
  it('returns them alongside the plan so the tab can explain what is unscheduled', () => {
    const tasksRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/matters/[matterId]/tasks/route.ts'),
      'utf8',
    )
    expect(tasksRoute).toContain('anchors: {')
    expect(tasksRoute).toContain('discoveryCallAt: firmDateKey(')
  })
})
