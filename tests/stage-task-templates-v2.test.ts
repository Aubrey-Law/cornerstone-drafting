import { describe, expect, it } from 'vitest'
import {
  PLAN_FLAG_KEYS,
  buildStageChecklist,
  findStageTaskTemplate,
  gatePasses,
  loadStageTaskTemplates,
  reconcileStageChecklist,
  type PlanGateContext,
  type StageChecklistItem,
} from '@/lib/stage-engine/stageTaskTemplates'
import { buildPlanGateContext } from '@/lib/stage-engine/planGateContext'

function context(overrides: Partial<PlanGateContext> = {}): PlanGateContext {
  return {
    planType: 'pour_over',
    flags: {},
    ...overrides,
  }
}

describe('stage-task templates v2', () => {
  const file = loadStageTaskTemplates()

  it('declares itself v2 and keeps every v1 key on every template', () => {
    expect(file.$schema).toBe('aubreylaw.stage-task-templates.v2')
    for (const template of file.templates) {
      expect(typeof template.stage_key).toBe('string')
      expect(template.fires_on).toBe('stage_entry')
      expect(typeof template.track).toBe('string')
      expect(['single', 'checklist']).toContain(template.task.type)
      expect(typeof template.task.soft_lead_days).toBe('number')
      expect('sla_days' in template.task).toBe(true)
    }
  })

  it('keeps the v1 templates and adds design, signing_scheduled and funding', () => {
    const keys = file.templates.map(t => t.stage_key)
    for (const existing of ['proposal_ea_out', 'drafting', 'revisions', 'closeout']) {
      expect(keys).toContain(existing)
    }
    for (const added of ['design', 'signing_scheduled', 'funding']) {
      expect(keys).toContain(added)
    }
  })

  it('gives funding a null SLA and a 30-day check-in', () => {
    const funding = findStageTaskTemplate('funding')
    expect(funding?.task.sla_days).toBeNull()
    expect(funding?.task.soft_lead_days).toBe(30)
  })

  it('starts the design SLA at the design meeting with 5 days', () => {
    const design = findStageTaskTemplate('design')
    expect(design?.task.sla_days).toBe(5)
    expect(design?.task.soft_lead_days).toBe(3)
  })

  it('names only known plan-flag keys in its gates', () => {
    for (const template of file.templates) {
      const gates = [template.gate, ...(template.task.checklist ?? []).map(item => item.gate)]
      for (const gate of gates) {
        if (gate === undefined || Array.isArray(gate)) continue
        expect(PLAN_FLAG_KEYS as readonly string[]).toContain(gate)
      }
    }
  })

  it('records document status on checklist items, never in a column set', () => {
    const drafting = findStageTaskTemplate('drafting')
    const produced = (drafting?.task.checklist ?? [])
      .map(item => item.produces_document)
      .filter(Boolean)
    expect(produced).toContain('revocable_trust')
    expect(produced).toContain('durable_power_of_attorney')
    expect(JSON.stringify(file)).not.toContain('document_checklist_')
  })
})

describe('gates', () => {
  it('pass when absent', () => {
    expect(gatePasses(undefined, context())).toBe(true)
  })

  it('read a plan flag by key', () => {
    expect(gatePasses('real_estate', context({ flags: { real_estate: true } }))).toBe(true)
    expect(gatePasses('real_estate', context({ flags: { real_estate: false } }))).toBe(false)
    expect(gatePasses('pets', context())).toBe(false)
  })

  it('read a plan-type list', () => {
    expect(gatePasses(['pour_over'], context({ planType: 'pour_over' }))).toBe(true)
    expect(gatePasses(['pour_over'], context({ planType: 'outright_will' }))).toBe(false)
  })

  it('pass a plan-type gate while the plan is still undecided', () => {
    // Before the design meeting, hiding the drafting items would read as
    // "no documents needed" rather than "not decided yet".
    expect(gatePasses(['pour_over'], context({ planType: null }))).toBe(true)
  })
})

describe('building a checklist', () => {
  const drafting = findStageTaskTemplate('drafting')!

  it('drops items whose flag is off', () => {
    const items = buildStageChecklist(drafting, context({ flags: { real_estate: false } }))
    expect(items.map(item => item.text)).not.toContain('Draft the transfer deed')
  })

  it('keeps items whose flag is on, unchecked', () => {
    const items = buildStageChecklist(drafting, context({ flags: { real_estate: true } }))
    const deed = items.find(item => item.text === 'Draft the transfer deed')
    expect(deed).toMatchObject({ done: false, produces_document: 'deed_transfer' })
  })

  it('picks the will for a will plan and the trust for a trust plan', () => {
    const trust = buildStageChecklist(drafting, context({ planType: 'pour_over' }))
      .map(item => item.text)
    expect(trust).toContain('Draft the revocable trust')
    expect(trust).not.toContain('Draft the last will and testament')

    const will = buildStageChecklist(drafting, context({ planType: 'outright_will' }))
      .map(item => item.text)
    expect(will).toContain('Draft the last will and testament')
    expect(will).not.toContain('Draft the revocable trust')
  })
})

describe('reconciling a flag change mid-stage', () => {
  const drafting = findStageTaskTemplate('drafting')!
  const off = context({ planType: 'pour_over', flags: { real_estate: false } })
  const on = context({ planType: 'pour_over', flags: { real_estate: true } })

  it('appends the newly-applicable items to the open task', () => {
    const before = buildStageChecklist(drafting, off)
    const after = reconcileStageChecklist(drafting, before, on)
    expect(after.map(item => item.text)).toContain('Draft the transfer deed')
    expect(after.find(item => item.text === 'Draft the transfer deed')?.done).toBe(false)
  })

  it('removes an incomplete item when the flag goes off', () => {
    const before = buildStageChecklist(drafting, on)
    const after = reconcileStageChecklist(drafting, before, off)
    expect(after.map(item => item.text)).not.toContain('Draft the transfer deed')
  })

  it('never deletes completed work', () => {
    const before: StageChecklistItem[] = buildStageChecklist(drafting, on).map(item =>
      item.text === 'Draft the transfer deed' ? { ...item, done: true } : item,
    )
    const after = reconcileStageChecklist(drafting, before, off)
    expect(after.find(item => item.text === 'Draft the transfer deed')).toMatchObject({ done: true })
  })

  it('keeps ticked boxes ticked through an unrelated change', () => {
    const before = buildStageChecklist(drafting, off).map(item =>
      item.text === 'Format and convert to PDF' ? { ...item, done: true } : item,
    )
    const after = reconcileStageChecklist(drafting, before, on)
    expect(after.find(item => item.text === 'Format and convert to PDF')?.done).toBe(true)
  })
})

describe('plan gate context', () => {
  it('reads the same facts the rail shows', () => {
    const built = buildPlanGateContext(
      {
        ep_has_pets: true,
        ep_signing_method: 'diy',
        billing_type: 'metlife',
        ep_separate_trusts: true,
      },
      {
        plan_type: 'pour_over',
        assets: [{ id: 'a', category: 'real_property', description: '', institution: '', estimated_value: 1, notes: '' }],
        children: [{ name: 'Kid', dob: null, relationship: 'biological', is_minor: true }],
      } as never,
    )

    expect(built.planType).toBe('pour_over')
    expect(built.flags).toMatchObject({
      real_estate: true,
      credit_shelter: true,
      minor_children: true,
      pets: true,
      diy_signing: true,
      legal_plan: true,
    })
  })

  it('lets a stored flag override what the design sheet implies', () => {
    const built = buildPlanGateContext({ ep_has_pets: false }, { pet_care_option: 'pet_trust' } as never)
    expect(built.flags.pets).toBe(false)
  })

  it('has no flags and no plan for a matter with nothing recorded', () => {
    const built = buildPlanGateContext(null, null)
    expect(built.planType).toBeNull()
    expect(Object.values(built.flags).every(value => !value)).toBe(true)
  })
})
