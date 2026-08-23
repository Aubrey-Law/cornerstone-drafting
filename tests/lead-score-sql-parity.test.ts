import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeLeadScore, type LeadScoreComponentKey, type LeadScoreInput } from '@/lib/leads/score'

/**
 * `lead_score()` (20261014000000) exists so the server can rank the whole
 * pipeline before paging it, which makes it a second statement of
 * `computeLeadScore()`. This holds the two together: every threshold and every
 * award is read out of the live SQL and then put to the TypeScript, which has
 * to answer with the same points.
 *
 * The list row carries no readiness percent, so that component scores 0 on
 * both sides and the SQL leaves it out entirely.
 */

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')

function newestSqlWith(needle: string): string {
  const files = fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort().reverse()
  for (const name of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    if (sql.includes(needle)) return sql
  }
  throw new Error(`no migration defines ${needle}`)
}

const SQL = newestSqlWith('function public.lead_score(')

/**
 * The arms of the SQL CASE, one per component, split on the alias each ends
 * with. Read positionally, so an arm that loses its alias fails loudly rather
 * than matching the neighbouring arm's numbers.
 */
function componentArms(): Record<string, string> {
  const body = SQL.slice(SQL.indexOf('), parts as ('), SQL.indexOf('select least(100'))
  const arms: Record<string, string> = {}
  let cursor = 0
  for (const match of body.matchAll(/\bas (progress|fee|estate|urgency|recency|appointment|source)\b/g)) {
    arms[match[1]] = body.slice(cursor, match.index)
    cursor = (match.index ?? 0) + match[0].length
  }
  return arms
}

const ARMS = componentArms()

function armFor(label: string): string {
  const arm = ARMS[label]
  expect(arm, `${label} is not computed in lead_score()`).toBeTruthy()
  return arm
}

const BASE: LeadScoreInput = {
  leadStatus: 'lead',
  intakeSentAt: null,
  intakeCompletedAt: null,
  intakeStatus: null,
  engagementStatus: null,
  engagementSentAt: null,
  engagementSignedAt: null,
  feeQuoted: null,
  billingType: null,
  taxableEstate: null,
  hasMinorChildren: null,
  urgency: null,
  leadSource: null,
  lastTouchAt: null,
  createdAt: null,
  nextAppointmentAt: null,
  readinessPercent: null,
}

function points(key: LeadScoreComponentKey, overrides: Partial<LeadScoreInput>): number {
  const score = computeLeadScore({ ...BASE, ...overrides })
  return score.components.find(component => component.key === key)?.points ?? -1
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/** Every number the arm awards, in the order the CASE tests for it. */
function awards(label: string): number[] {
  return [...armFor(label).matchAll(/then (\d+)|else (\d+)/g)]
    .map(match => Number(match[1] ?? match[2]))
}

/** Every threshold the arm compares against. */
function thresholds(label: string): number[] {
  return [...armFor(label).matchAll(/>=\s*(\d+)|<=\s*(\d+)/g)]
    .map(match => Number(match[1] ?? match[2]))
}

describe('lead_score() and computeLeadScore() award the same points', () => {
  it('for pipeline progress', () => {
    expect(awards('progress')).toEqual([20, 16, 12, 6, 0])
    expect(points('progress', { engagementSignedAt: daysAgo(1) })).toBe(20)
    expect(points('progress', { engagementStatus: 'sent' })).toBe(16)
    expect(points('progress', { intakeStatus: 'completed' })).toBe(12)
    expect(points('progress', { intakeSentAt: daysAgo(2) })).toBe(6)
    expect(points('progress', {})).toBe(0)
  })

  it('for the revenue signal, at the same fee thresholds', () => {
    expect(thresholds('fee')).toEqual([5000, 3000, 1500])
    expect(awards('fee')).toEqual([15, 12, 8, 5, 7, 0])
    expect(points('fee', { feeQuoted: 5000 })).toBe(15)
    expect(points('fee', { feeQuoted: 4999 })).toBe(12)
    expect(points('fee', { feeQuoted: 3000 })).toBe(12)
    expect(points('fee', { feeQuoted: 2999 })).toBe(8)
    expect(points('fee', { feeQuoted: 1500 })).toBe(8)
    expect(points('fee', { feeQuoted: 1499 })).toBe(5)
    expect(points('fee', { billingType: 'metlife' })).toBe(7)
    expect(points('fee', {})).toBe(0)
  })

  it('for estate complexity, including the minor-children bump', () => {
    expect(thresholds('estate')).toEqual([2000000, 1000000])
    // 15/10/5 by estate value, then the minor-children bump (2, else 0), then
    // the same 2 for minor children with no estate value at all (else 0).
    expect(awards('estate')).toEqual([15, 10, 5, 2, 0, 2, 0])
    expect(points('estate', { taxableEstate: 2_000_000 })).toBe(15)
    // Capped at the component maximum, which the SQL states as least(15, …).
    expect(points('estate', { taxableEstate: 2_000_000, hasMinorChildren: true })).toBe(15)
    expect(SQL).toContain('least(15, case')
    expect(points('estate', { taxableEstate: 1_000_000 })).toBe(10)
    expect(points('estate', { taxableEstate: 1, hasMinorChildren: true })).toBe(7)
    expect(points('estate', { hasMinorChildren: true })).toBe(2)
    expect(points('estate', {})).toBe(0)
  })

  it('for urgency, scoring unset above low', () => {
    expect(awards('urgency')).toEqual([10, 5, 0, 4])
    expect(points('urgency', { urgency: 'high' })).toBe(10)
    expect(points('urgency', { urgency: 'normal' })).toBe(5)
    expect(points('urgency', { urgency: 'low' })).toBe(0)
    expect(points('urgency', {})).toBe(4)
  })

  it('for recent contact, at the same day boundaries', () => {
    expect(thresholds('recency')).toEqual([3, 7, 14, 30])
    expect(awards('recency')).toEqual([0, 15, 11, 6, 2, 0])
    expect(points('recency', { lastTouchAt: daysAgo(0) })).toBe(15)
    expect(points('recency', { lastTouchAt: daysAgo(3) })).toBe(15)
    expect(points('recency', { lastTouchAt: daysAgo(4) })).toBe(11)
    expect(points('recency', { lastTouchAt: daysAgo(7) })).toBe(11)
    expect(points('recency', { lastTouchAt: daysAgo(8) })).toBe(6)
    expect(points('recency', { lastTouchAt: daysAgo(14) })).toBe(6)
    expect(points('recency', { lastTouchAt: daysAgo(15) })).toBe(2)
    expect(points('recency', { lastTouchAt: daysAgo(30) })).toBe(2)
    expect(points('recency', { lastTouchAt: daysAgo(31) })).toBe(0)
    expect(points('recency', {})).toBe(0)
  })

  it('for a meeting, crediting a booked one over a held one', () => {
    expect(awards('appointment')).toEqual([0, 10, 5])
    expect(points('appointment', { nextAppointmentAt: daysAhead(4) })).toBe(10)
    expect(points('appointment', { nextAppointmentAt: new Date().toISOString() })).toBe(10)
    expect(points('appointment', { nextAppointmentAt: daysAgo(2) })).toBe(5)
    expect(points('appointment', {})).toBe(0)
  })

  it('for the lead source', () => {
    expect(awards('source')).toEqual([2, 10, 8, 5, 4])
    expect(points('source', { leadSource: 'Client referral' })).toBe(10)
    expect(points('source', { leadSource: 'metlife' })).toBe(8)
    expect(points('source', { leadSource: 'Website form' })).toBe(5)
    expect(points('source', { leadSource: 'seminar' })).toBe(4)
    expect(points('source', { leadSource: '' })).toBe(2)
    expect(points('source', {})).toBe(2)
  })

  it('reads the same legal-plan billing types on both sides', () => {
    const ts = fs.readFileSync(path.join(process.cwd(), 'lib/leads/score.ts'), 'utf8')
    const declared = ts.slice(ts.indexOf('const LEGAL_PLAN_BILLING_TYPES'))
    const plans = [...declared.slice(0, declared.indexOf(']')).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(plans.length).toBeGreaterThan(0)
    const fee = armFor('fee')
    for (const plan of plans) expect(fee, `${plan} missing from lead_score()`).toContain(`'${plan}'`)
    // And in the source arm, where a plan name in the source is a referral.
    const source = armFor('source')
    for (const plan of plans) expect(source, `${plan} missing from the source arm`).toContain(plan)
  })

  it('omits readiness, which a list row never carries', () => {
    expect(points('readiness', {})).toBe(0)
    // No arm computes it — the header says why, which is why this reads the
    // shape of the CASE rather than the whole file.
    expect(SQL).not.toMatch(/as readiness\b/)
    // Which is why the SQL sums to 95 of the 100 the components declare.
    const maxima = computeLeadScore(BASE).components.reduce((sum, component) => sum + component.max, 0)
    expect(maxima).toBe(100)
  })
})

describe('the leads list view', () => {
  const view = newestSqlWith('create or replace view public.v_lead_list')

  it('takes lifecycle from the matter when there is one', () => {
    expect(view).toContain('coalesce(m.relationship_status, ci.lead_status) as lead_status')
  })

  it('drops archived matters and hired leads, as the page did', () => {
    expect(view).toMatch(/coalesce\(m\.status, ''\) <> 'archived'/)
    expect(view).toMatch(/in \('lead', 'lost', 'declined'\)/)
  })

  it('falls back to updated_at when a lead has no activity, as the score input does', () => {
    expect(view).toContain('coalesce(la.last_activity_at, ci.updated_at)')
  })

  it('resolves the compound progress states, which a null-dropping neq could not', () => {
    expect(view).toContain('as intake_complete')
    expect(view).toContain('as engagement_pending')
  })
})
