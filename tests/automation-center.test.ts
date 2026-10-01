import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_TEMPLATES,
  SYSTEM_AUTOMATIONS,
  automationApprovalPolicy,
  nextCronOccurrence,
} from '@/lib/automations/registry'
import { validateAutomationRule } from '@/lib/automations/server'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20270102090400_phase4_automation_center.sql'), 'utf8')
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
  crons: Array<{ path: string; schedule: string }>
}

describe('Phase 4 automation center', () => {
  it('inventories every deployment cron exactly as configured', () => {
    const expected = SYSTEM_AUTOMATIONS.flatMap(automation =>
      automation.schedules.map(schedule => ({ path: automation.path, schedule })))
    expect(vercel.crons).toEqual(expect.arrayContaining(expected))
    expect(expected).toHaveLength(vercel.crons.length)
  })

  it('routes every deployment cron through the shared run control', () => {
    for (const automation of SYSTEM_AUTOMATIONS) {
      const route = fs.readFileSync(path.join(root, `app${automation.path}/route.ts`), 'utf8')
      expect(route).toContain("from '@/lib/automations/control'")
      expect(route).toContain(`runSystemAutomation('${automation.key}'`)
    }
  })

  it('computes the next UTC cron occurrence deterministically', () => {
    expect(nextCronOccurrence('*/5 * * * *', new Date('2026-10-01T12:01:30Z'))?.toISOString())
      .toBe('2026-10-01T12:05:00.000Z')
    expect(nextCronOccurrence('0 12 * * 1-5', new Date('2026-10-02T12:00:00Z'))?.toISOString())
      .toBe('2026-10-05T12:00:00.000Z')
  })

  it('ships all ten allowlisted templates and no arbitrary code action', () => {
    expect(AUTOMATION_TEMPLATES).toHaveLength(10)
    expect(AUTOMATION_TEMPLATES.map(template => template.key)).toEqual(expect.arrayContaining([
      'new-lead-intake', 'appointment-preparation', 'overdue-intake', 'engagement-onboarding',
      'stage-entry', 'stale-lead-follow-up', 'unanswered-message', 'signing-closeout',
      'annual-review', 'overdue-invoice',
    ]))
    expect(AUTOMATION_TEMPLATES.map(template => template.actionKey)).not.toContain('execute_code')
  })

  it('cannot weaken approval for an externally consequential action', () => {
    expect(automationApprovalPolicy('propose_send_message')).toBe('required')
    expect(validateAutomationRule({
      name: 'Unsafe send', triggerKey: 'lead_stale', actionKey: 'propose_send_message',
      approvalPolicy: 'automatic', mode: 'live',
    }).approvalPolicy).toBe('required')
  })

  it('uses invoker RPCs, leases, idempotency, retry state, and linked action audits', () => {
    expect(migration).toContain('create or replace function public.claim_automation_run')
    expect(migration).toContain('security invoker')
    expect(migration).toContain('lease_expires_at')
    expect(migration).toContain('idempotency_key')
    expect(migration).toContain('retry_requested_at')
    expect(migration).toContain('retry_requested_at = coalesce(retry_requested_at, clock_timestamp())')
    expect(migration).toContain("case when p_status = 'succeeded'")
    expect(migration).toContain('automation_run_id uuid references public.automation_runs')
    expect(migration).toContain("check (status in ('running', 'dry_run', 'succeeded', 'failed', 'cancelled', 'skipped'))")
  })

  it('keeps dry-run output operational and side-effect free', () => {
    const source = fs.readFileSync(path.join(root, 'lib/automations/server.ts'), 'utf8')
    const dryRun = source.slice(source.indexOf('export async function dryRunAutomation'), source.indexOf('async function loadActor'))
    expect(dryRun).toContain('evaluateAutomationRule')
    expect(dryRun).toContain("status: 'dry_run'")
    expect(dryRun).toContain('executedCount: 0')
    expect(dryRun).not.toContain('createActionProposal')
    expect(dryRun).not.toContain('executeActionProposal')
  })
})
