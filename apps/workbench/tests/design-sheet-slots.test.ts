import { describe, expect, it } from 'vitest'
import { loadSourceRows } from '@/lib/prompts/designSheet'
import { makeFakeClient } from './helpers/fakeSupabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'

const MATTER = { id: 'matter-1', name: 'Parker Family Trust' }

function sheet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sheet-1',
    matter_id: 'matter-1',
    version: 1,
    guardian_slots: null,
    temporary_guardian_slots: null,
    trustee_slots: null,
    executor_slots: null,
    hcp_slots: null,
    poa_slots: null,
    ...overrides,
  }
}

/**
 * A `*_slots` value is stored as `[{id, is_co, order, contact_id}]` — a
 * contact_id is a foreign key, and a model asked whether "Thomas Parker" is
 * in the plan cannot answer from a UUID. `loadSourceRows` has to resolve
 * every slot to the contact's name before a prompt ever sees it.
 */
describe('loadSourceRows resolving *_slots to names', () => {
  it("resolves a slot to its contact's name, dropping contact_id", async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          guardian_slots: [{ id: 'slot-1', is_co: false, order: 1, contact_id: 'contact-1' }],
        }),
      ],
      contacts: [{ id: 'contact-1', first_name: 'Thomas', middle_name: null, last_name: 'Parker' }],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<WorkbenchDatabase>, 'matter-1')

    expect(result?.design_sheet.guardian_slots).toEqual([{ order: 1, is_co: false, name: 'Thomas Parker' }])
  })

  it('yields a null name, rather than dropping the slot, when the contact is absent', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          guardian_slots: [{ id: 'slot-1', is_co: true, order: 2, contact_id: 'ghost-contact' }],
        }),
      ],
      contacts: [],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<WorkbenchDatabase>, 'matter-1')

    expect(result?.design_sheet.guardian_slots).toEqual([{ order: 2, is_co: true, name: null }])
  })

  it('leaves a sheet with no slots unchanged', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [sheet()],
      contacts: [],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<WorkbenchDatabase>, 'matter-1')

    expect(result?.design_sheet.guardian_slots).toBeNull()
    expect(result?.design_sheet.trustee_slots).toBeNull()
  })

  it('resolves several slot columns against one contacts query', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          trustee_slots: [{ id: 's1', is_co: false, order: 1, contact_id: 'contact-1' }],
          executor_slots: [{ id: 's2', is_co: false, order: 1, contact_id: 'contact-2' }],
        }),
      ],
      contacts: [
        { id: 'contact-1', first_name: 'Susan', middle_name: null, last_name: 'Purdue' },
        { id: 'contact-2', first_name: 'Robin', middle_name: null, last_name: 'Parker' },
      ],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<WorkbenchDatabase>, 'matter-1')

    expect(result?.design_sheet.trustee_slots).toEqual([{ order: 1, is_co: false, name: 'Susan Purdue' }])
    expect(result?.design_sheet.executor_slots).toEqual([{ order: 1, is_co: false, name: 'Robin Parker' }])
  })
})
