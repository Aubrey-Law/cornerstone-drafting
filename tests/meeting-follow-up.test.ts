import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * The meeting follow-up. After a note lands on a matter or lead, what the
 * firm proposes is a table: design decisions (matter only, when the sheet
 * would change), one task per attorney to-do, and one recap when there is a
 * client to send it to. These pin the table down, pin the model's answer to
 * its bounds, and pin that every step is a proposal through the dial.
 */

vi.mock('server-only', () => ({}))

import {
  coerceMeetingExtraction,
  emailHtmlFromParagraphs,
  planMeetingActions,
  type MeetingExtraction,
} from '@/lib/meetings/followUp'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG, autonomyCeilingForRisk, defaultAutonomyForAction } from '@/lib/actions/autonomy'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const MATTER = '00000000-0000-0000-0000-000000000060'
const LEAD = '00000000-0000-0000-0000-000000000050'
const recipient = { email: 'pat@example.com', name: 'Pat Client' }

const extraction: MeetingExtraction = {
  summary: 'Decided on a joint revocable trust.',
  actionItems: [
    { title: 'Draft the joint trust', detail: 'Pour-over wills for both spouses.', dueInDays: 14 },
    { title: 'Send the funding letter', detail: null, dueInDays: null },
  ],
  clientRequests: ['Send the deed to the lake house', 'Confirm the successor trustee'],
  followUpEmail: { subject: 'Recap of today’s design meeting', paragraphs: ['Thank you for meeting today.', 'We will draft the joint trust next.'] },
}

describe('reading the model’s answer', () => {
  it('keeps titles, bounds counts and due dates, and drops items without a title', () => {
    const read = coerceMeetingExtraction({
      summary: '  Decided   things ',
      action_items: [
        { title: 'A', due_in_days: 0 },
        { title: 'B', due_in_days: 9999.4 },
        { detail: 'no title' },
        ...Array.from({ length: 12 }, (_, index) => ({ title: `Item ${index}` })),
      ],
      client_requests: ['Send the deed', 42, '', 'Confirm the trustee'],
      follow_up_email: { subject: 'Recap', paragraphs: ['One', '', 'Two'] },
    })
    expect(read.summary).toBe('Decided things')
    expect(read.actionItems).toHaveLength(10)
    expect(read.actionItems[0]).toEqual({ title: 'A', detail: null, dueInDays: 1 })
    expect(read.actionItems[1].dueInDays).toBe(365)
    expect(read.clientRequests).toEqual(['Send the deed', 'Confirm the trustee'])
    expect(read.followUpEmail).toEqual({ subject: 'Recap', paragraphs: ['One', 'Two'] })
  })

  it('treats a non-object, or an email without a subject or body, as nothing to do', () => {
    expect(coerceMeetingExtraction(null)).toEqual({ summary: null, actionItems: [], clientRequests: [], followUpEmail: null })
    expect(coerceMeetingExtraction([1, 2])).toEqual({ summary: null, actionItems: [], clientRequests: [], followUpEmail: null })
    expect(coerceMeetingExtraction({ follow_up_email: { subject: 'Recap', paragraphs: [] } }).followUpEmail).toBeNull()
    expect(coerceMeetingExtraction({ follow_up_email: { paragraphs: ['Hi'] } }).followUpEmail).toBeNull()
  })

  it('escapes the recap when it becomes HTML', () => {
    expect(emailHtmlFromParagraphs(['Tom & Jerry <trust>', 'Line one\nLine two']))
      .toBe('<p>Tom &amp; Jerry &lt;trust&gt;</p><p>Line one<br>Line two</p>')
  })
})

describe('what a meeting proposes', () => {
  const base = { title: 'Design meeting', meetingDate: '2026-10-05', recipient, extraction, now: NOW }

  it('on a matter: the design decisions as one batch, one task per to-do, and the recap', () => {
    const plan = planMeetingActions({ ...base, matterId: MATTER, leadId: null, designFields: { plan_type: 'joint_trust', trust_name: 'The Client Family Trust' } })
    expect(plan.map(item => [item.actionKey, item.slot])).toEqual([
      ['design_sheet.proposal.apply', 'design'],
      ['task.create', 'task-1'],
      ['task.create', 'task-2'],
      ['email.draft.compose', 'email'],
    ])
    expect(plan[0].summary).toBe('Apply 2 design decisions from "Design meeting"')
    expect(plan[0].payload).toEqual({ matterId: MATTER, fields: { plan_type: 'joint_trust', trust_name: 'The Client Family Trust' } })
    expect(plan.every(item => item.recordType === 'matter' && item.recordId === MATTER)).toBe(true)
  })

  it('dates each task from the notes, or a week out, and says which meeting it came from', () => {
    const plan = planMeetingActions({ ...base, matterId: MATTER, leadId: null, designFields: null })
    const tasks = plan.filter(item => item.actionKey === 'task.create')
    expect(tasks[0].payload).toMatchObject({
      title: 'Draft the joint trust',
      matter_id: MATTER,
      lead_id: null,
      source: 'automation',
      due_at: new Date(NOW + 14 * 86_400_000).toISOString(),
    })
    expect(tasks[0].payload.description).toBe('Pour-over wills for both spouses.\nFrom the meeting "Design meeting" on 2026-10-05.')
    expect(tasks[1].payload).toMatchObject({ due_at: new Date(NOW + 7 * 86_400_000).toISOString() })
    expect(tasks[1].payload.description).toBe('From the meeting "Design meeting" on 2026-10-05.')
  })

  it('on a lead: never a design-sheet batch, even when fields were offered', () => {
    const plan = planMeetingActions({ ...base, matterId: null, leadId: LEAD, designFields: { plan_type: 'joint_trust' } })
    expect(plan.map(item => item.actionKey)).toEqual(['task.create', 'task.create', 'email.draft.compose'])
    expect(plan[0].payload).toMatchObject({ matter_id: null, lead_id: LEAD })
    expect(plan.every(item => item.recordType === 'lead' && item.recordId === LEAD)).toBe(true)
  })

  it('writes the recap to the client, with what the client agreed to send, as a composer draft', () => {
    const plan = planMeetingActions({ ...base, matterId: MATTER, leadId: null, designFields: null })
    const email = plan.find(item => item.actionKey === 'email.draft.compose')!
    expect(email.summary).toBe('Draft the follow-up email to Pat Client after "Design meeting"')
    expect(email.payload).toMatchObject({ contextType: 'matter', contextId: MATTER, to: 'pat@example.com', subject: 'Recap of today’s design meeting' })
    expect(email.payload.bodyHtml).toBe(
      '<p>Thank you for meeting today.</p><p>We will draft the joint trust next.</p>'
      + '<p>What we need from you: Send the deed to the lake house; Confirm the successor trustee.</p>',
    )
  })

  it('skips the recap when there is no one to send it to, or nothing honest to say', () => {
    const noRecipient = planMeetingActions({ ...base, matterId: MATTER, leadId: null, designFields: null, recipient: null })
    expect(noRecipient.map(item => item.actionKey)).toEqual(['task.create', 'task.create'])
    const thin = planMeetingActions({ ...base, matterId: MATTER, leadId: null, designFields: null, extraction: { ...extraction, followUpEmail: null } })
    expect(thin.some(item => item.actionKey === 'email.draft.compose')).toBe(false)
  })

  it('proposes nothing without a record, and nothing when the notes said nothing', () => {
    expect(planMeetingActions({ ...base, matterId: null, leadId: null, designFields: { plan_type: 'joint_trust' } })).toEqual([])
    const empty: MeetingExtraction = { summary: null, actionItems: [], clientRequests: [], followUpEmail: null }
    expect(planMeetingActions({ ...base, matterId: MATTER, leadId: null, designFields: null, extraction: empty })).toEqual([])
  })
})

describe('the design-sheet and compose actions', () => {
  it('cap design decisions at Propose: a legal decision is never applied unattended', () => {
    const definition = getActionDefinition('design_sheet.proposal.apply')
    expect(definition?.risk).toBe('legal_financial')
    expect(autonomyCeilingForRisk('legal_financial')).toBe('propose')
    expect(defaultAutonomyForAction('design_sheet.proposal.apply')).toBe('propose')
    expect(ACTION_CATALOG['design_sheet.proposal.apply']).toBeDefined()
    expect(ACTION_CATALOG['email.draft.compose']).toBeDefined()
  })

  it('only let known design-sheet fields through', () => {
    const definition = getActionDefinition('design_sheet.proposal.apply')!
    expect(definition.validate({ matterId: MATTER, fields: { plan_type: 'joint_trust', made_up: 'x', __proto__: { a: 1 } } }, { id: 'u' }))
      .toEqual({ matterId: MATTER, fields: { plan_type: 'joint_trust' } })
    expect(() => definition.validate({ matterId: MATTER, fields: { made_up: 'x' } }, { id: 'u' })).toThrow('known design-sheet field')
    expect(() => definition.validate({ fields: { plan_type: 'joint_trust' } }, { id: 'u' })).toThrow('matter identifier')
  })

  it('prepare a composer draft as a preparation, with an undo that removes only what it created', () => {
    const definition = getActionDefinition('email.draft.compose')
    expect(definition?.risk).toBe('prepare')
    expect(definition?.undo).toBeDefined()
    expect(defaultAutonomyForAction('email.draft.compose')).toBe('act_report')
    const validated = definition!.validate({
      contextType: 'matter', contextId: MATTER, to: 'PAT@example.com', subject: 'Recap',
      bodyHtml: '<p>Hello</p><script>alert(1)</script>',
    }, { id: 'u' }) as { to: string; bodyHtml: string }
    expect(validated.to).toBe('pat@example.com')
    expect(validated.bodyHtml).toContain('<p>Hello</p>')
    expect(validated.bodyHtml).not.toContain('<script')
    expect(() => definition!.validate({ contextType: 'general', contextId: MATTER, to: 'pat@example.com', subject: 'x', bodyHtml: '<p>x</p>' }, { id: 'u' })).toThrow('matter or lead')
    expect(() => definition!.validate({ contextType: 'lead', contextId: LEAD, to: 'nope', subject: 'x', bodyHtml: '<p>x</p>' }, { id: 'u' })).toThrow('recipient email')
  })

  it('leaves a draft a person already had open alone, on preview, on execute and on undo', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const block = source.slice(source.indexOf("key: 'email.draft.compose'"), source.indexOf("key: 'task.delegate'"))
    expect(block).toContain('Keep the email draft already in the composer')
    expect(block).toContain('if (existing) return { id: existing.id, prepared: false, preservedExisting: true }')
    expect(block).toContain("if (record.afterState?.prepared !== true) return { draftId, removed: false }")
  })
})

describe('where the follow-up runs', () => {
  it('is queued behind the response from each meeting-note route, keyed to the saved note', () => {
    const matter = fs.readFileSync('app/api/admin/meeting-notes/route.ts', 'utf8')
    expect(matter.indexOf("from('matter_activity').insert")).toBeLessThan(matter.indexOf('scheduleMeetingFollowUp({'))
    expect(matter).toContain('sourceKey: data.id')
    expect(matter).toContain('export const maxDuration = 60')

    const manual = fs.readFileSync('app/api/admin/leads/[id]/meeting-notes/route.ts', 'utf8')
    expect(manual).toContain('scheduleMeetingFollowUp({leadId:id')
    expect(manual).toContain('sourceKey:data.id')

    const granola = fs.readFileSync('app/api/admin/leads/[id]/meeting-notes/granola/route.ts', 'utf8')
    expect(granola).toContain('if (result.imported && userId)')
    expect(granola).toContain('sourceKey: result.meeting_note.id')

    const schedule = fs.readFileSync('lib/meetings/schedule.ts', 'utf8')
    expect(schedule).toContain("import { after } from 'next/server'")
    expect(schedule).toContain('catch (error)')
  })

  it('hands every step to the dial as an automation proposal keyed to the note, and chains the send after the draft', () => {
    const source = fs.readFileSync('lib/meetings/followUp.ts', 'utf8')
    expect(source).toContain("source: 'automation'")
    expect(source).toContain('applyAutonomy: true')
    expect(source).toContain('idempotencyKey: `meeting:${input.sourceKey}:${item.slot}`')
    expect(source).toContain('idempotencyKey: `meeting:${input.sourceKey}:email-send`')
    expect(source).toContain("actionKey: 'email.draft.send'")
    expect(source).not.toContain("from('tasks').insert")
    expect(source).not.toContain("from('design_sheets')")
    // Only fields the notes would change are offered; a sheet already saying the same thing is left alone.
    expect(source).toContain('row.currentDisplay !== row.proposedDisplay')
  })
})
