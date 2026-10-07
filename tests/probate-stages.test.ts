import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROBATE_STAGE_KEYS, PROBATE_STAGES, readProbateStage } from '@/lib/probateStages/model'
import { PIPELINE_SLA_PHASES, SLA_PHASES, SLA_PHASE_LABEL, isPreEngagementPhase } from '@/lib/slaTasks/types'
import { summarizeSlaProgress } from '@/lib/slaTasks/schedule'
import { progressFromMatterDetails } from '@/lib/portal/progress'

/**
 * A probate matter's stage is read from the dates on the record, never set by
 * hand or stored on `matters.stage`. These pin the reading, that a missing
 * earlier date is a gap rather than assumed done, that the checklist files
 * under probate's own phases, and that the portal shows the same stages.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const TODAY = '2026-10-07'

describe('reading the stage from the record', () => {
  it('starts at Opening with nothing recorded', () => {
    const reading = readProbateStage({}, TODAY)
    expect(reading.stage).toBe('probate_opening')
    expect(reading.steps.map(step => step.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
    expect(reading.nextStep).toMatch(/petition/)
    expect(readProbateStage(null, TODAY).stage).toBe('probate_opening')
  })

  it('moves with each date the attorney records', () => {
    expect(readProbateStage({ pb_petition_filed_date: '2026-06-01' }, TODAY).stage).toBe('probate_petition_filed')
    expect(readProbateStage({ pb_petition_filed_date: '2026-06-01', pb_letters_issued_date: '2026-07-15' }, TODAY).stage).toBe('probate_appointed')
    const inventory = readProbateStage({ pb_petition_filed_date: '2026-06-01', pb_pr_appointment_date: '2026-07-10', pb_inventory_filed_date: '2026-09-30' }, TODAY)
    expect(inventory.stage).toBe('probate_inventory_filed')
    expect(inventory.gaps).toEqual([])
    expect(inventory.steps.find(step => step.key === 'probate_appointed')?.reachedOn).toBe('2026-07-10')
  })

  it('takes the earlier of the appointment and letters dates', () => {
    const reading = readProbateStage({ pb_pr_appointment_date: '2026-07-10', pb_letters_issued_date: '2026-07-01' }, TODAY)
    expect(reading.steps.find(step => step.key === 'probate_appointed')?.reachedOn).toBe('2026-07-01')
  })

  it('counts the claims period as over only once its end date has passed', () => {
    const facts = { pb_inventory_filed_date: '2026-03-01', pb_claims_period_end_date: '2026-10-07' }
    expect(readProbateStage(facts, '2026-10-06').stage).toBe('probate_inventory_filed')
    expect(readProbateStage(facts, TODAY).stage).toBe('probate_claims_closed')
  })

  it('shows a missing earlier date as a gap, not as done', () => {
    const reading = readProbateStage({ pb_inventory_filed_date: '2026-09-01' }, TODAY)
    expect(reading.stage).toBe('probate_inventory_filed')
    expect(reading.gaps).toEqual(['probate_petition_filed', 'probate_appointed'])
    expect(reading.steps[0].state).toBe('done')
  })

  it('closes on the closed flag even without a date', () => {
    const reading = readProbateStage({ pb_final_distribution_date: '2026-09-01', pb_estate_closed: true }, TODAY)
    expect(reading.stage).toBe('probate_closed')
    expect(reading.nextStep).toBeNull()
  })
})

describe('the checklist files under probate stages', () => {
  it('has a phase and a label for every probate stage, after the matter stages', () => {
    for (const key of PROBATE_STAGE_KEYS) {
      expect(SLA_PHASES).toContain(key)
      expect(SLA_PHASE_LABEL[key]).toBeTruthy()
      expect(isPreEngagementPhase(key)).toBe(false)
      expect(SLA_PHASES.indexOf(key)).toBeGreaterThan(SLA_PHASES.indexOf('closed'))
      // Never a matters.stage value, so never on pipeline_stage_rank().
      expect(PIPELINE_SLA_PHASES).not.toContain(key)
    }
    expect(PROBATE_STAGES.map(stage => stage.key)).toEqual([...PROBATE_STAGE_KEYS])
  })

  it('reports progress by probate phase', () => {
    const task = (phase: string, status: string) => ({
      phase, status, start_date: '2026-10-01', due_date: '2026-10-20', skipped_at: null, total_paused_days: 0,
      extends_target_days: 0, relative_to: null, pre_engagement: false,
    })
    const progress = summarizeSlaProgress([task('probate_opening', 'done'), task('probate_petition_filed', 'open')] as never, { today: TODAY })
    expect(progress.currentPhase).toBe('probate_petition_filed')
  })

  it('moves the template and its generated tasks off the estate-planning names', () => {
    const sql = read('supabase/migrations/20270125090000_probate_stage_phases.sql')
    expect(sql).toContain("where template_name = 'probate_sla_v1'")
    expect(sql).toContain("and s.template_name = 'probate_sla_v1'")
    for (const [from, to] of [['design', 'probate_opening'], ['drafting', 'probate_petition_filed'], ['client_review', 'probate_appointed'], ['closed', 'probate_closed']]) {
      expect(sql).toContain(`when '${from}' then jsonb_set(task, '{phase}', '"${to}"')`)
      expect(sql).toContain(`when '${from}' then '${to}'`)
    }
    expect(sql).not.toMatch(/update public\.matters\b/)
  })
})

describe('where it shows', () => {
  it('replaces the estate-planning strip on a probate matter only', () => {
    const detail = read('app/admin/matters/[id]/MatterDetailClient.tsx')
    expect(detail).toContain('{showProbate ? (\n              <ProbateStageStrip details={matterDetails} />')
  })

  it('gives the portal the same stages, each complete only on its own date', () => {
    const progress = progressFromMatterDetails({ practice_area: 'Probate', pb_petition_filed_date: '2026-06-01', pb_claims_period_end_date: '2026-10-01' } as never, TODAY)
    expect(progress.milestones.map(milestone => [milestone.key, milestone.state])).toEqual([
      ['petition_filed', 'completed'],
      ['appointed', 'pending'],
      ['inventory_filed', 'pending'],
      ['claims_closed', 'completed'],
      ['distributed', 'pending'],
      ['closed', 'pending'],
    ])
  })
})
