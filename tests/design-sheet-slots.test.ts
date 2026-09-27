import { describe, expect, it } from 'vitest'
import { loadSourceRows } from '@/lib/prompts/designSheet'
import { makeFakeClient } from './helpers/reviewFakeSupabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'

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
 *
 * The contact ids here are real uuids on purpose. They used to be
 * `'contact-1'`, which no `contacts.id` could ever hold — so no test could
 * reach the failure that mattered: on 2026-09-09 a slot holding the sentinel
 * `__design_sheet_client__` was passed to `.in('id', ...)` against that uuid
 * column, Postgres rejected it, and the resulting throw stranded a stage
 * trigger in `claimed` with no run and no recorded error. A fixture that does
 * not match the column's type cannot find a bug about the column's type.
 */
describe('loadSourceRows resolving *_slots to names', () => {
  it("resolves a slot to its contact's name, dropping contact_id", async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          guardian_slots: [{ id: 'slot-1', is_co: false, order: 1, contact_id: '11111111-1111-4111-8111-111111111111' }],
        }),
      ],
      contacts: [{ id: '11111111-1111-4111-8111-111111111111', first_name: 'Thomas', middle_name: null, last_name: 'Parker' }],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

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

    const result = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

    expect(result?.design_sheet.guardian_slots).toEqual([{ order: 2, is_co: true, name: null }])
  })

  it('leaves a sheet with no slots unchanged', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [sheet()],
      contacts: [],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

    expect(result?.design_sheet.guardian_slots).toBeNull()
    expect(result?.design_sheet.trustee_slots).toBeNull()
  })

  it('resolves several slot columns against one contacts query', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          trustee_slots: [{ id: 's1', is_co: false, order: 1, contact_id: '11111111-1111-4111-8111-111111111111' }],
          executor_slots: [{ id: 's2', is_co: false, order: 1, contact_id: '22222222-2222-4222-8222-222222222222' }],
        }),
      ],
      contacts: [
        { id: '11111111-1111-4111-8111-111111111111', first_name: 'Susan', middle_name: null, last_name: 'Purdue' },
        { id: '22222222-2222-4222-8222-222222222222', first_name: 'Robin', middle_name: null, last_name: 'Parker' },
      ],
    })

    const result = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

    expect(result?.design_sheet.trustee_slots).toEqual([{ order: 1, is_co: false, name: 'Susan Purdue' }])
    expect(result?.design_sheet.executor_slots).toEqual([{ order: 1, is_co: false, name: 'Robin Parker' }])
  })

  /**
   * The sentinels, and the reason they cannot simply be filtered out.
   *
   * `__design_sheet_client__` and `__design_sheet_spouse__` stand in for
   * people the sheet names itself, stored in the same field as a foreign key.
   * Measured 2026-09-09: 7 of 44 sheets carry one, and five of those matters
   * sit at stages the audit fires on.
   *
   * Dropping them from the contacts query stops the crash and leaves the slot
   * `name: null`, which would be worse: check 2 asks whether a person named in
   * the free text appears in the structured decisions, so a spouse serving as
   * trustee would read as an unnamed slot and be reported missing from the
   * plan — a false blocker on five matters, from a fix that "worked".
   *
   * Owner's ruling, 2026-09-09: they resolve to the sheet's own names.
   */
  it('resolves the client sentinel to the sheet’s client_name', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          client_name: 'Lauren Ashley Chapman',
          trustee_slots: [{ id: 's1', is_co: false, order: 1, contact_id: '__design_sheet_client__' }],
        }),
      ],
      contacts: [],
    })

    const rows = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

    expect((rows!.design_sheet as Record<string, unknown>).trustee_slots).toEqual([
      { order: 1, is_co: false, name: 'Lauren Ashley Chapman' },
    ])
  })

  it('resolves the spouse sentinel to the sheet’s spouse_name', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          spouse_name: 'Daniel Adam Chapman',
          executor_slots: [{ id: 's1', is_co: false, order: 1, contact_id: '__design_sheet_spouse__' }],
        }),
      ],
      contacts: [],
    })

    const rows = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

    expect((rows!.design_sheet as Record<string, unknown>).executor_slots).toEqual([
      { order: 1, is_co: false, name: 'Daniel Adam Chapman' },
    ])
  })

  /**
   * The crash itself. A sentinel must never reach `.in('id', ...)`, because
   * `contacts.id` is a uuid column and Postgres rejects the whole query — which
   * is what threw, stranding a stage trigger in `claimed` with nothing recorded.
   * Failing the contacts table proves the query is not attempted at all.
   */
  it('never asks the contacts table about a sentinel', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          client_name: 'Lauren Ashley Chapman',
          trustee_slots: [{ id: 's1', is_co: false, order: 1, contact_id: '__design_sheet_client__' }],
        }),
      ],
      contacts: [],
    })
    client.failTable('contacts', 'invalid input syntax for type uuid: "__design_sheet_client__"')

    // Resolves rather than throwing, because contacts is never queried.
    const rows = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')
    expect((rows!.design_sheet as Record<string, unknown>).trustee_slots).toEqual([
      { order: 1, is_co: false, name: 'Lauren Ashley Chapman' },
    ])
  })

  /** A sentinel whose name column is empty is still a fact about the matter,
   *  reported as an unnamed slot rather than hidden. */
  it('yields a null name when the sentinel’s column is empty', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({
          spouse_name: null,
          hcp_slots: [{ id: 's1', is_co: false, order: 1, contact_id: '__design_sheet_spouse__' }],
        }),
      ],
      contacts: [],
    })

    const rows = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')

    expect((rows!.design_sheet as Record<string, unknown>).hcp_slots).toEqual([
      { order: 1, is_co: false, name: null },
    ])
  })

  /** An unrecognised non-uuid is not a sentinel and not a contact: name null,
   *  and still never sent to the query. */
  it('yields a null name for an unrecognised non-uuid, without querying', async () => {
    const client = makeFakeClient({
      matters: [MATTER],
      design_sheets: [
        sheet({ poa_slots: [{ id: 's1', is_co: false, order: 1, contact_id: 'not-a-uuid-at-all' }] }),
      ],
      contacts: [],
    })
    client.failTable('contacts', 'invalid input syntax for type uuid: "not-a-uuid-at-all"')

    const rows = await loadSourceRows(client as unknown as SupabaseClient<GeneratedDatabase>, 'matter-1')
    expect((rows!.design_sheet as Record<string, unknown>).poa_slots).toEqual([
      { order: 1, is_co: false, name: null },
    ])
  })
})
