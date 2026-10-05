import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  ACTION_AUTONOMY_LEVELS,
  ACTION_CATALOG,
  autonomyCeilingForRisk,
  clampAutonomy,
  compareAutonomy,
  confirmationPolicyForAutonomy,
  confirmationPolicyForRisk,
  parseActionAutonomy,
} from '@/lib/actions/autonomy'
import { getActionDefinition, listActionDefinitions } from '@/lib/actions/registry'

const read = (rel: string) => fs.readFileSync(rel, 'utf8')

describe('delegation dial: positions and ceilings', () => {
  it('orders the four positions from least to most autonomous', () => {
    expect(ACTION_AUTONOMY_LEVELS).toEqual(['observe', 'propose', 'act_report', 'act_silent'])
    expect(compareAutonomy('observe', 'act_silent')).toBeLessThan(0)
    expect(compareAutonomy('act_report', 'propose')).toBeGreaterThan(0)
    expect(parseActionAutonomy('act_report')).toBe('act_report')
    expect(parseActionAutonomy('delete_everything')).toBeNull()
  })

  it('never lets legal judgment or external sends run unreported', () => {
    expect(autonomyCeilingForRisk('internal_write')).toBe('act_silent')
    expect(autonomyCeilingForRisk('prepare')).toBe('act_silent')
    expect(autonomyCeilingForRisk('external_write')).toBe('act_report')
    expect(autonomyCeilingForRisk('legal_financial')).toBe('propose')
    expect(autonomyCeilingForRisk('prohibited')).toBe('observe')
    expect(clampAutonomy('act_silent', 'external_write')).toBe('act_report')
    expect(clampAutonomy('act_silent', 'legal_financial')).toBe('propose')
    expect(clampAutonomy('observe', 'internal_write')).toBe('observe')
  })

  it('drops the confirmation only when an acting position is actually allowed', () => {
    expect(confirmationPolicyForAutonomy('act_report', 'internal_write')).toBe('automatic')
    expect(confirmationPolicyForAutonomy('act_report', 'external_write')).toBe('automatic')
    expect(confirmationPolicyForAutonomy('act_silent', 'legal_financial')).toBe('explicit')
    expect(confirmationPolicyForAutonomy('propose', 'internal_write')).toBe('one_click')
    expect(confirmationPolicyForAutonomy('observe', 'external_write')).toBe('explicit')
    expect(confirmationPolicyForAutonomy('act_silent', 'prohibited')).toBe('never')
    // The risk-only policy is unchanged for human-initiated proposals.
    expect(confirmationPolicyForRisk('external_write')).toBe('explicit')
  })

  it('describes every registry action in plain words for the settings page', () => {
    for (const { key } of listActionDefinitions()) {
      expect(ACTION_CATALOG[key], `missing catalog entry for ${key}`).toBeDefined()
      expect(ACTION_CATALOG[key].label.length).toBeGreaterThan(3)
    }
  })
})

describe('delegation dial: undo', () => {
  it('exists only for actions with a clean inverse', () => {
    for (const key of ['task.create', 'note.create', 'calendar.hold.create', 'task.start', 'task.complete', 'task.delegate']) {
      expect(typeof getActionDefinition(key)?.undo, `${key} should be undoable`).toBe('function')
    }
    for (const key of ['email.draft.send', 'matter.stage.transition', 'lead.create', 'workflow.enqueue', 'daily_plan.commit']) {
      expect(getActionDefinition(key)?.undo, `${key} must not be undoable`).toBeUndefined()
    }
  })

  it('restores a task to its recorded earlier status rather than guessing', async () => {
    const calls: Array<Record<string, unknown>> = []
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 't1', status: 'done', checklist: [], completed_at: null, completed_by: null, recurrence: null, title: 'x' },
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          calls.push(patch)
          return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 't1', ...patch }, error: null }) }) }) }
        },
      }),
    }
    const context = { admin: admin as never, actor: { id: 'u1' }, source: 'today' as const, idempotencyKey: 'undo:x' }
    const definition = getActionDefinition('task.complete')!
    await expect(definition.undo!({ taskId: '00000000-0000-0000-0000-000000000001' }, { beforeState: null, afterState: null }, context))
      .rejects.toThrow('earlier status')
    await expect(definition.undo!({ taskId: '00000000-0000-0000-0000-000000000001' }, { beforeState: { status: 'bogus' }, afterState: null }, context))
      .rejects.toThrow('earlier status')
  })
})

describe('delegation dial: where it is applied', () => {
  const server = read('lib/actions/server.ts')
  const automations = read('lib/automations/server.ts')
  const migration = read('supabase/migrations/20270104090000_delegation_dial.sql')

  it('speaks only for callers that opt in, and runs through the same execution gate', () => {
    const create = server.slice(server.indexOf('export async function createActionProposal'), server.indexOf('export async function getActionProposalPreview'))
    expect(create).toContain('request.applyAutonomy\n    ? await resolveActionAutonomy(')
    expect(create).toContain(": 'propose'")
    expect(create).toContain("status: autonomy === 'observe' ? 'observed' : 'pending'")
    expect(create).toContain('if (!isActingAutonomy(autonomy)) return created')
    expect(create).toContain('await executeActionProposal(String(data.id), actor)')
    // The acting path is reached only after the insert, never before the preview.
    expect(create.indexOf('definition.preview(input, context)')).toBeLessThan(create.indexOf('resolveActionAutonomy('))
  })

  it('lets a rule narrow the dial but not widen it', () => {
    expect(automations).toContain('applyAutonomy: true')
    expect(automations).toContain("autonomyCeiling: rule.approval_policy === 'required' ? 'propose' : undefined")
    expect(automations).not.toContain("rule.approval_policy === 'automatic' && created.confirmation.policy")
    expect(automations).toContain("created.execution?.status === 'succeeded'")
  })

  it('stores positions server-side only and adds the terminal states the dial needs', () => {
    expect(migration).toContain('create table public.action_autonomy_settings')
    expect(migration).toContain("check (autonomy in ('observe', 'propose', 'act_report', 'act_silent'))")
    expect(migration).toContain('revoke all on table public.action_autonomy_settings from anon, authenticated')
    expect(migration).toContain("'executed', 'failed', 'observed'")
    expect(migration).toContain("'running', 'succeeded', 'failed', 'undone'")
    expect(migration).toContain('add column undone_at timestamptz')
    expect(migration).toContain("add column autonomy text not null default 'propose'")
  })

  it('is reachable from Settings and reports on Today and in the digest', () => {
    expect(read('app/admin/settings/settingsNav.ts')).toContain("tab: 'delegation'")
    expect(read('app/admin/settings/StaffSettingsClient.tsx')).toContain("tab === 'delegation' && <DelegationSettingsSection")
    const today = read('app/admin/(today)/page.tsx')
    expect(today.split('<DelegatedActivityCard />').length - 1).toBe(2)
    const digest = read('app/api/cron/daily-digest/route.ts')
    expect(digest).toContain('listDelegatedActivity')
    expect(digest).toContain('Done for you since yesterday')
    expect(digest).toContain("delegated.done.length === 0 && delegated.observed.length === 0")
  })

  it('requires the administrator role to move the dial', () => {
    const route = read('app/api/admin/settings/delegation/route.ts')
    const patch = route.slice(route.indexOf('export async function PATCH'))
    expect(patch).toContain('requireAdministrator(req)')
  })
})
