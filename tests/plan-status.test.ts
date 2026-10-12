import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * "Where is my plan?" These pin every sentence a client can be shown from
 * the record alone, the fingerprint that keeps a stage change from being
 * offered twice, the bounds on the model's rewrite, and the update's path
 * through the delegation dial.
 */

vi.mock('server-only', () => ({}))

import {
  coercePlanStatusDraft,
  describePlanStatus,
  planStatusDigest,
  PLAN_STATUS_MAX_CHARS,
  type PlanStatusFacts,
} from '@/lib/portal/planStatus'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG, autonomyCeilingForRisk, defaultAutonomyForAction } from '@/lib/actions/autonomy'
import { STAGES } from '@/types/database'

const MATTER = '00000000-0000-0000-0000-000000000070'

function facts(overrides: Partial<PlanStatusFacts> = {}): PlanStatusFacts {
  return {
    stage: 'drafting',
    stageLabel: 'Drafting',
    track: 'estate-planning',
    milestones: [
      { key: 'intake', label: 'Intake', state: 'completed' },
      { key: 'drafts', label: 'Drafts', state: 'pending' },
    ],
    nextAppointment: null,
    funding: null,
    clientFollowUp: [],
    stageChangedAt: '2026-10-01T12:00:00Z',
    firmName: 'Aubrey Law',
    attorneyShortName: 'Scott',
    ...overrides,
  }
}

describe('the plain status, written from the record alone', () => {
  it('has a sentence for every stage, and says what comes next for every open one', () => {
    for (const stage of STAGES) {
      const text = describePlanStatus(facts({ stage: stage.key, stageLabel: stage.label }))
      expect(text.length, stage.key).toBeGreaterThan(40)
      expect(text, stage.key).toMatch(/\.$/)
    }
    expect(describePlanStatus(facts({ stage: 'drafting' }))).toContain('being drafted')
    expect(describePlanStatus(facts({ stage: 'drafting' }))).toContain('share them in your portal')
    expect(describePlanStatus(facts({ stage: 'closed', stageLabel: 'Closed' }))).toContain('Your matter is complete')
    expect(describePlanStatus(facts({ stage: 'closed', stageLabel: 'Closed' }))).toContain('stay available here')
  })

  it('names the next appointment with its kind and day, and only when one is booked', () => {
    const booked = describePlanStatus(facts({
      stage: 'drafts_approved',
      nextAppointment: { startsAt: '2026-10-09T18:00:00Z', typeLabel: 'Signing' },
    }))
    expect(booked).toContain('Your next appointment, signing, is on Friday, October 9.')
    const bare = describePlanStatus(facts({ nextAppointment: { startsAt: '2026-10-09T18:00:00Z', typeLabel: null } }))
    expect(bare).toContain('Your next appointment with us is on Friday, October 9.')
    expect(describePlanStatus(facts())).not.toContain('appointment')
  })

  it('reports funding progress once the plan is signed, and not before', () => {
    const funding = { total: 4, funded: 1, outstanding: 3 }
    expect(describePlanStatus(facts({ stage: 'funding', funding })))
      .toContain('1 of 4 assets is titled to the plan so far, with 3 still to go.')
    expect(describePlanStatus(facts({ stage: 'funding', funding: { total: 2, funded: 2, outstanding: 0 } })))
      .toContain('All 2 of your assets are now titled to the plan.')
    expect(describePlanStatus(facts({ stage: 'design', funding }))).not.toContain('titled to the plan')
    expect(describePlanStatus(facts({ stage: 'funding', funding: { total: 0, funded: 0, outstanding: 0 } }))).not.toContain('titled to the plan')
  })

  it('lists what the firm still needs from the client, at most three items, in one sentence', () => {
    expect(describePlanStatus(facts({ clientFollowUp: ['Signed engagement letter'] })))
      .toContain('From you we still need: signed engagement letter.')
    expect(describePlanStatus(facts({ clientFollowUp: ['Signed engagement letter', 'Retainer payment', 'Deed copy', 'Fourth thing'] })))
      .toContain('From you we still need: signed engagement letter, Retainer payment and Deed copy.')
    expect(describePlanStatus(facts())).not.toContain('From you')
  })

  it('keeps an open questionnaire as the story when the stage is already drafting', () => {
    const open = describePlanStatus(facts({ stage: 'drafting', intakeComplete: false }))
    expect(open).toContain('working from what we have')
    expect(open).toContain('questionnaire is still open')
    expect(open.toLowerCase()).not.toContain('settled')
    expect(open.toLowerCase()).not.toContain('being drafted')
    expect(describePlanStatus(facts({ stage: 'drafting', intakeComplete: true }))).toContain('being drafted')
    expect(describePlanStatus(facts({ stage: 'drafting', intakeComplete: true }))).toContain('design we settled on')
    expect(describePlanStatus(facts({ stage: 'closed', stageLabel: 'Closed', intakeComplete: false }))).toContain('Your matter is complete')
  })
})

describe('the fingerprint of what the update would say', () => {
  it('is stable for the same facts and changes with the stage, a booking, a funding step or a new requirement', () => {
    const base = planStatusDigest(facts())
    expect(planStatusDigest(facts())).toBe(base)
    expect(planStatusDigest(facts({ stage: 'client_review' }))).not.toBe(base)
    expect(planStatusDigest(facts({ nextAppointment: { startsAt: '2026-10-09T18:00:00Z', typeLabel: null } }))).not.toBe(base)
    expect(planStatusDigest(facts({ funding: { total: 3, funded: 1, outstanding: 2 } }))).not.toBe(base)
    expect(planStatusDigest(facts({ clientFollowUp: ['Deed copy'] }))).not.toBe(base)
    expect(planStatusDigest(facts({
      milestones: [{ key: 'intake', label: 'Intake', state: 'completed' }, { key: 'drafts', label: 'Drafts', state: 'completed' }],
    }))).not.toBe(base)
  })

  it('ignores what the client would not notice: the time of day of a booking, or the firm names', () => {
    const base = planStatusDigest(facts({ nextAppointment: { startsAt: '2026-10-09T18:00:00Z', typeLabel: 'Signing' } }))
    expect(planStatusDigest(facts({ nextAppointment: { startsAt: '2026-10-09T19:30:00Z', typeLabel: 'Signing meeting' } }))).toBe(base)
    expect(planStatusDigest(facts({ nextAppointment: { startsAt: '2026-10-09T18:00:00Z', typeLabel: 'Signing' }, attorneyShortName: 'Someone' }))).toBe(base)
  })
})

describe('the bounds on the model’s rewrite', () => {
  const plain = describePlanStatus(facts())

  it('keeps a well-formed draft, flattened to one paragraph', () => {
    expect(coercePlanStatusDraft({ body: 'Your documents are being drafted now.\n\nWe will share them in your portal soon.' }, plain))
      .toBe('Your documents are being drafted now. We will share them in your portal soon.')
  })

  it('falls back to the plain draft when the answer is not an object, has no body, or is too short', () => {
    expect(coercePlanStatusDraft(null, plain)).toBe(plain)
    expect(coercePlanStatusDraft(['x'], plain)).toBe(plain)
    expect(coercePlanStatusDraft({ text: 'hello' }, plain)).toBe(plain)
    expect(coercePlanStatusDraft({ body: 'Soon.' }, plain)).toBe(plain)
  })

  it('cuts an overlong answer at the limit', () => {
    const long = coercePlanStatusDraft({ body: 'word '.repeat(600) }, plain)
    expect(long.length).toBeLessThanOrEqual(PLAN_STATUS_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('the update’s path through the dial', () => {
  it('is a client-facing write: Propose by default, never silent, listed under communications', () => {
    const definition = getActionDefinition('portal.status.publish')
    expect(definition?.risk).toBe('external_write')
    expect(autonomyCeilingForRisk('external_write')).toBe('act_report')
    expect(defaultAutonomyForAction('portal.status.publish')).toBe('propose')
    expect(ACTION_CATALOG['portal.status.publish']?.group).toBe('communications')
    expect(definition?.undo).toBeUndefined()
  })

  it('validates the matter, a known stage and a body that says something', () => {
    const definition = getActionDefinition('portal.status.publish')!
    const body = describePlanStatus(facts())
    expect(definition.validate({ matterId: MATTER, stage: 'drafting', body, facts: { stage: 'drafting' } }, { id: 'u' }))
      .toEqual({ matterId: MATTER, stage: 'drafting', body, facts: { stage: 'drafting' } })
    expect(definition.validate({ matterId: MATTER, stage: 'drafting', body, facts: ['no'] }, { id: 'u' }))
      .toMatchObject({ facts: {} })
    expect(() => definition.validate({ stage: 'drafting', body }, { id: 'u' })).toThrow('needs a matter')
    expect(() => definition.validate({ matterId: MATTER, stage: 'launch', body }, { id: 'u' })).toThrow('known matter stage')
    expect(() => definition.validate({ matterId: MATTER, stage: 'drafting', body: 'Soon.' }, { id: 'u' })).toThrow('at least 40')
    expect(() => definition.validate({ matterId: MATTER, stage: 'drafting', body: 'x'.repeat(1_201) }, { id: 'u' })).toThrow('1200 characters or fewer')
  })

  it('shows the attorney the words the client would read', async () => {
    const definition = getActionDefinition('portal.status.publish')!
    const body = describePlanStatus(facts())
    const preview = await definition.preview(
      { matterId: MATTER, stage: 'drafting', body, facts: {} },
      { admin: {} as never, actor: { id: 'u' }, source: 'automation' } as never,
    )
    expect(preview.display).toMatchObject({ action: 'Post a plan update to the client', stage: 'Drafting', body })
  })
})

describe('where the update is offered and shown', () => {
  it('is offered from both stage writes, for every stage but closed, after the stage has changed', () => {
    const route = fs.readFileSync('app/api/admin/matters/[id]/stage/route.ts', 'utf8')
    expect(route).toContain("import { schedulePlanStatusUpdate } from '@/lib/portal/delegatePlanStatus'")
    expect(route).toContain("if (!result.unchanged && stage !== 'closed') {\n      schedulePlanStatusUpdate({ matterId, actorId: userId })")

    const mutation = fs.readFileSync('lib/matters/stageMutation.ts', 'utf8')
    expect(mutation).toContain("if (!result.unchanged && input.stage !== 'closed') {")
    expect(mutation).toContain("schedulePlanStatusUpdate({ matterId: input.matterId, actorId: input.actor.id })")
  })

  it('keys the proposal to the matter and the fingerprint, and lets the dial apply', () => {
    const source = fs.readFileSync('lib/portal/delegatePlanStatus.ts', 'utf8')
    expect(source).toContain("actionKey: 'portal.status.publish'")
    expect(source).toContain('idempotencyKey: `plan-status:${input.matterId}:${planStatusDigest(loaded.facts)}`')
    expect(source).toContain('applyAutonomy: true')
    expect(source).toContain("if (loaded.matter.status === 'archived') return 'skipped'")
  })

  it('publishes as a portal message and a record row, and the dashboard shows the newest or the plain draft', () => {
    const server = fs.readFileSync('lib/portal/planStatusServer.ts', 'utf8')
    expect(server).toContain(".from('messages')")
    expect(server).toContain("sender_role: 'attorney'")
    expect(server).toContain(".from('matter_status_updates')")
    expect(server).toContain('notifyClientOfFirmMessage(input.matterId)')

    const dashboard = fs.readFileSync('app/(portal)/dashboard/page.tsx', 'utf8')
    expect(dashboard).toContain('Where your plan stands')
    expect(dashboard).toContain('settled(fetchLatestPlanStatus(matter.id), null)')
    expect(dashboard).toContain('describePlanStatus(intakeOpen ? { ...plainStatus.facts, intakeComplete: false } : plainStatus.facts)')
  })

  it('has its table, with client read access scoped to their own matter, and generated types', () => {
    const migration = fs.readFileSync('supabase/migrations/20270113090000_matter_status_updates.sql', 'utf8')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.matter_status_updates')
    expect(migration).toContain("CHECK (source IN ('automation', 'staff'))")
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('matter_status_updates_client_select')
    expect(migration).toContain('ci.user_id = (select auth.uid()) OR ci.client_user_id = (select auth.uid())')

    const types = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    expect(types).toContain('matter_status_updates: {')
  })
})
