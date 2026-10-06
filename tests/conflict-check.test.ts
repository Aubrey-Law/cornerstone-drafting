import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Conflict-of-interest checks at lead creation. These pin what counts as a
 * match and how strongly, that the lead's own records never match
 * themselves, the lifecycle requirement the attorney's decision satisfies,
 * the hire guard, and where the check is wired in.
 */

import {
  conflictCheckSatisfied,
  conflictDigest,
  conflictResult,
  describeConflictCheck,
  findConflicts,
  matchCandidate,
  nameTokens,
  normaliseName,
  normalisePhone,
  type ConflictCandidate,
  type ConflictCheckState,
  type ConflictSubject,
} from '@/lib/conflicts/match'
import { evaluateLeadRequirements, leadOperationalBrief } from '@/lib/lifecycle/lead'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

const subject: ConflictSubject = {
  names: ['Patricia O’Brien', 'Pat O\'Brien'],
  emails: ['pat.obrien@example.com'],
  phones: ['+1 (617) 555-0100'],
}

function candidate(overrides: Partial<ConflictCandidate> = {}): ConflictCandidate {
  return {
    kind: 'matter',
    id: 'm1',
    label: 'Sam Jones',
    context: 'Client · Jones Estate Plan',
    href: '/admin/matters/m1',
    names: ['Sam Jones'],
    emails: ['sam@example.com'],
    phones: ['781-555-0199'],
    ...overrides,
  }
}

describe('what counts as a match', () => {
  it('normalises names and phones the way people write them', () => {
    expect(nameTokens("Patricia O'Brien, Jr.")).toEqual(['patricia', 'obrien'])
    expect(normaliseName('  José  Álvarez-Smith ')).toBe('jose alvarez smith')
    expect(normalisePhone('+1 (617) 555-0100')).toBe('6175550100')
    expect(normalisePhone('617.555.0100')).toBe('6175550100')
  })

  it('treats a shared email or phone as a strong match whatever the name says', () => {
    expect(matchCandidate(subject, candidate({ names: ['S. Jones'], emails: ['PAT.OBRIEN@example.com'] })))
      .toMatchObject({ strength: 'strong', matchedOn: ['email'] })
    expect(matchCandidate(subject, candidate({ phones: ['617 555 0100'] })))
      .toMatchObject({ strength: 'strong', matchedOn: ['phone'], matchedValue: '617 555 0100' })
  })

  it('reads the same full name as strong, surname plus initial as possible, surname alone as nothing', () => {
    expect(matchCandidate(subject, candidate({ names: ['Patricia OBrien'] }))).toMatchObject({ strength: 'strong', matchedOn: ['name'] })
    expect(matchCandidate(subject, candidate({ names: ['P. O\'Brien'] }))).toMatchObject({ strength: 'possible', matchedOn: ['surname'] })
    expect(matchCandidate(subject, candidate({ names: ['Peter O\'Brien'] }))).toMatchObject({ strength: 'possible' })
    expect(matchCandidate(subject, candidate({ names: ['Michael O\'Brien'] }))).toBeNull()
    expect(matchCandidate(subject, candidate())).toBeNull()
  })

  it('lists each record once, strongest first, and names the result', () => {
    const hits = findConflicts(subject, [
      candidate({ id: 'weak', label: 'Paul O\'Brien', names: ['Paul O\'Brien'] }),
      candidate({ id: 'strong', label: 'Pat O\'Brien', kind: 'lead', names: ['Pat O\'Brien'] }),
      candidate({ id: 'strong', label: 'Pat O\'Brien', kind: 'lead', names: ['Pat O\'Brien'] }),
      candidate({ id: 'none' }),
    ])
    expect(hits.map(hit => hit.id)).toEqual(['strong', 'weak'])
    expect(conflictResult(hits)).toBe('possible')
    expect(conflictResult([])).toBe('clear')
    expect(conflictDigest(hits)).toBe('lead:strong:name|matter:weak:surname')
    expect(conflictDigest([])).toBe('clear')
  })
})

describe('the attorney’s decision', () => {
  const state = (overrides: Partial<ConflictCheckState>): ConflictCheckState => ({
    id: 'c1', result: 'possible', decision: 'pending', hits: [], checkedAt: '2026-10-06T12:00:00Z', decidedAt: null, note: null, ...overrides,
  })

  it('is satisfied by a clear search or a recorded "no conflict", never by a recorded conflict', () => {
    expect(conflictCheckSatisfied(null)).toBe(false)
    expect(conflictCheckSatisfied(state({ result: 'clear', decision: 'no_conflict' }))).toBe(true)
    expect(conflictCheckSatisfied(state({ result: 'possible', decision: 'pending' }))).toBe(false)
    expect(conflictCheckSatisfied(state({ result: 'possible', decision: 'no_conflict' }))).toBe(true)
    expect(conflictCheckSatisfied(state({ result: 'clear', decision: 'conflict' }))).toBe(false)
  })

  it('reads in one line', () => {
    expect(describeConflictCheck(null)).toBe('Not checked yet.')
    expect(describeConflictCheck(state({ result: 'clear', decision: 'no_conflict' }))).toContain('No matches')
    const hit = { kind: 'matter' as const, id: 'm', label: 'x', context: '', href: '', matchedOn: ['email' as const], strength: 'strong' as const, matchedValue: '' }
    expect(describeConflictCheck(state({ hits: [hit, { ...hit, id: 'n', strength: 'possible' }] }))).toBe('2 possible matches, 1 strong · needs your review.')
    expect(describeConflictCheck(state({ decision: 'conflict' }))).toContain('Conflict recorded')
  })

  it('is a blocking lead requirement only when the caller loads the check', () => {
    const lead = { id: 'l1', practice_area: 'EP', lead_status: 'lead', status: 'draft' } as unknown as LeadDetailRecord
    const keys = (requirements: ReturnType<typeof evaluateLeadRequirements>) => requirements.map(r => r.key)
    expect(keys(evaluateLeadRequirements(lead, null))).not.toContain('lead.conflict_check')
    const unchecked = evaluateLeadRequirements(lead, null, { conflictCheck: null }).find(r => r.key === 'lead.conflict_check')
    expect(unchecked).toMatchObject({ satisfied: false, blocksStage: true, owner: 'attorney' })
    const cleared = evaluateLeadRequirements(lead, null, { conflictCheck: { result: 'clear', decision: 'no_conflict' } }).find(r => r.key === 'lead.conflict_check')
    expect(cleared?.satisfied).toBe(true)
    const brief = leadOperationalBrief({ lead, spouse: null, conflictCheck: { result: 'possible', decision: 'conflict' } })
    expect(brief.blockers.map(b => b.label)).toContain('Conflict of interest recorded')
    expect(brief.attorneyDecision).toContain('Conflict of interest recorded')
  })
})

describe('where it is wired', () => {
  it('runs behind every lead creation path, excluding the lead’s own records', () => {
    for (const file of ['lib/leads/createLead.ts', 'lib/appointments/book.ts', 'lib/bookings/sync.ts']) {
      expect(fs.readFileSync(file, 'utf8'), file).toContain('scheduleConflictCheck(lead.id)')
    }
    const server = fs.readFileSync('lib/conflicts/server.ts', 'utf8')
    expect(server).toContain('if (id === exclude.leadId) continue')
    expect(server).toContain("if (contact.relationship_type === 'self') continue")
    expect(server).toContain("if (member.relationship_type !== 'spouse') continue")
  })

  it('stores a clear run as decided and raises a possible one as a task through the dial', () => {
    const server = fs.readFileSync('lib/conflicts/server.ts', 'utf8')
    expect(server).toContain("decision: result === 'clear' ? 'no_conflict' : 'pending'")
    expect(server).toContain('if (hits.length > 0) {')
    expect(server).toContain("actionKey: 'task.create'")
    expect(server).toContain('idempotencyKey: `conflict-check:${input.leadId}:${conflictDigest(input.state.hits)}`')
    expect(server).toContain('applyAutonomy: true')
    expect(server).toContain('conflict_check_completed: true')
  })

  it('never hires a lead with a recorded conflict, by any path', () => {
    const hire = fs.readFileSync('lib/matters/createFromIntake.ts', 'utf8')
    expect(hire).toContain('conflictBlocksHire(intakeId, admin)')
    expect(hire.indexOf('conflictBlocksHire')).toBeLessThan(hire.indexOf('convert_lead_to_matter'))
    const server = fs.readFileSync('lib/conflicts/server.ts', 'utf8')
    expect(server).toContain("if (state?.decision === 'conflict')")
  })

  it('has a staff route for the card, and the card on the lead page feeds the brief', () => {
    const route = fs.readFileSync('app/api/admin/leads/[id]/conflict-check/route.ts', 'utf8')
    for (const handler of ['export async function GET', 'export async function POST', 'export async function PATCH']) {
      const start = route.indexOf(handler)
      expect(start, handler).toBeGreaterThan(-1)
      expect(route.slice(start, start + 400)).toContain('requireAdmin(req)')
    }
    expect(route).toContain("decision !== 'no_conflict' && decision !== 'conflict'")

    const page = fs.readFileSync('app/admin/leads/[id]/page.tsx', 'utf8')
    expect(page).toContain('fetchLatestConflictCheck(id)')
    expect(page).toContain('initialConflictCheck={initialConflictCheck}')
    const client = fs.readFileSync('app/admin/leads/[id]/LeadDetailClient.tsx', 'utf8')
    expect(client).toContain('<LeadConflictCard')
    expect(client).toContain('conflictCheck,\n  })')
    expect(client).toContain('onChange={setConflictCheck}')
  })

  it('has its table, staff-only, and generated types', () => {
    const migration = fs.readFileSync('supabase/migrations/20270115090000_conflict_checks.sql', 'utf8')
    expect(migration).toContain('create table if not exists public.conflict_checks')
    expect(migration).toContain("check (result in ('clear', 'possible'))")
    expect(migration).toContain("check (decision in ('pending', 'no_conflict', 'conflict'))")
    expect(migration).toContain('enable row level security')
    expect(migration).toContain('conflict_checks_staff_all')
    expect(migration).not.toContain('client_intake ci on')
    const types = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    expect(types).toContain('      conflict_checks: {')
  })
})
