import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string; message: string } | null }

const tableResults = new Map<string, Result>()
const tableFilters = new Map<string, Array<[string, unknown]>>()

function builder(table: string) {
  const result = () => tableResults.get(table) ?? { data: [], error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'limit']) chain[method] = () => chain
  chain.eq = (column: string, value: unknown) => {
    tableFilters.set(table, [...(tableFilters.get(table) ?? []), [column, value]])
    return chain
  }
  chain.maybeSingle = () => Promise.resolve(result())
  chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject)
  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: (table: string) => builder(table) }),
}))

vi.mock('@/lib/queries', () => ({
  fetchMatter: async () => ({ id: 'matter-1', client_name: 'Ada Ferraro', has_minor_children: false, practice_area: null }),
  fetchMatterContacts: async () => [],
  fetchIntakeForMatter: async () => null,
  fetchDesignSheet: async () => ({ client_name: 'Ada Ferraro', decisions: {} }),
}))

vi.mock('@/lib/designSheetReadiness', () => ({
  computeDesignSheetReadiness: () => ({ blocking: [], optional: [], complete: false }),
}))

import { buildCompletionContext, LEAD_MEETING_NOTE_TYPE } from '@/lib/designSheetCompletion/context'
import { buildFactsBlock } from '@/lib/designSheetCompletion/engine'

beforeEach(() => {
  tableResults.clear()
  tableFilters.clear()
  tableResults.set('matters', { data: { client_intake_id: 'lead-1' }, error: null })
  tableResults.set('matter_details', { data: null, error: null })
  tableResults.set('matter_notes', {
    data: [{ id: 'mn1', note_type: 'internal', body: 'Signing set for June.', created_at: '2026-09-01' }],
    error: null,
  })
})

describe('completion context meeting material', () => {
  it('includes the lead meeting notes for the matter\'s intake, labelled as such', async () => {
    tableResults.set('lead_meeting_notes', {
      data: [{ id: 'lm1', title: 'PMPS', body: 'Wants Mary Okafor as successor trustee.', meeting_date: '2026-08-01' }],
      error: null,
    })

    const context = await buildCompletionContext('matter-1')

    expect(tableFilters.get('lead_meeting_notes')).toEqual([['lead_id', 'lead-1']])
    expect(context.notes.map(note => note.id)).toEqual(['mn1', 'lm1'])
    expect(context.notes[1]).toEqual({
      id: 'lm1',
      note_type: LEAD_MEETING_NOTE_TYPE,
      body: 'PMPS\nWants Mary Okafor as successor trustee.',
      created_at: '2026-08-01',
    })

    const facts = buildFactsBlock(context, { kind: 'blockers' })
    expect(facts).toContain(`[${LEAD_MEETING_NOTE_TYPE} 2026-08-01] PMPS`)
    expect(facts).toContain('Wants Mary Okafor as successor trustee.')
  })

  it('still builds the context from matter notes when lead_meeting_notes is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    tableResults.set('lead_meeting_notes', {
      data: null,
      error: { code: '42P01', message: 'relation "public.lead_meeting_notes" does not exist' },
    })

    const context = await buildCompletionContext('matter-1')

    expect(context.notes.map(note => note.id)).toEqual(['mn1'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('schema unavailable'), expect.any(String))
    warn.mockRestore()
  })

  it('does not query lead meeting notes when the matter has no intake', async () => {
    tableResults.set('matters', { data: { client_intake_id: null }, error: null })

    const context = await buildCompletionContext('matter-1')

    expect(tableFilters.has('lead_meeting_notes')).toBe(false)
    expect(context.notes.map(note => note.id)).toEqual(['mn1'])
  })
})
