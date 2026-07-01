import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { childInputToContactPayload, contactRowToDesignSheetChild, type HouseholdChildInput } from './childMapping'

type AdminClient = SupabaseClient<Database>

export type { HouseholdChildInput } from './childMapping'

function contactKey(first: unknown, last: unknown): string {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

/**
 * The single, authoritative writer for the children of a household.
 * contacts is the source of truth; design_sheets.children is a maintained
 * projection rebuilt from contacts on every call ("always overwrite from
 * contacts"). Reconcile preserves the guard: a departed child holding any
 * contact_roles is kept (never delete a role-holding child, which would
 * cascade-drop their fiduciary role).
 */
export async function saveHouseholdChildren(
  admin: AdminClient,
  intakeId: string,
  children: HouseholdChildInput[],
): Promise<{ ids: string[] }> {
  const submitted = (children ?? []).filter((c) => {
    const name = c.name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`
    return name.trim().length > 0
  })

  if ((children?.length ?? 0) > 0 && submitted.length === 0) {
    throw new Error(
      `saveHouseholdChildren: ${children.length} child input(s) had no usable name — refusing to overwrite the contacts child set (likely a shape mismatch). Aborting to avoid data loss.`,
    )
  }

  // Step 1+2: read contacts and client_intake concurrently (contacts first in array)
  const [{ data: existingChildren }, { data: intakeRow }] = await Promise.all([
    admin.from('contacts').select('id, first_name, last_name').eq('client_intake_id', intakeId).eq('relationship_type', 'child'),
    admin.from('client_intake').select('address_line1, city, state, zip').eq('id', intakeId).maybeSingle(),
  ])

  const existing = (existingChildren ?? []) as Array<{ id: string; first_name: string; last_name: string }>
  const byId = new Set(existing.map((c) => c.id))
  const byName = new Map(existing.map((c) => [contactKey(c.first_name, c.last_name), c.id]))

  // Step 3: per submitted child — update or insert into contacts
  const keptIds = new Set<string>()
  for (const c of submitted) {
    const payload = childInputToContactPayload(c, (intakeRow as Record<string, unknown> | null) ?? null)
    const cid = typeof c.contact_id === 'string' && /^[\da-f-]{36}$/i.test(c.contact_id.trim()) ? c.contact_id.trim() : null
    const existingId = (cid && byId.has(cid) ? cid : byName.get(contactKey(payload.first_name, payload.last_name))) ?? null
    if (existingId) {
      const { error } = await admin.from('contacts').update(payload).eq('id', existingId)
      if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
      keptIds.add(existingId)
    } else {
      const { data: inserted, error } = await admin
        .from('contacts').insert({ client_intake_id: intakeId, ...payload }).select('id').single()
      if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
      if ((inserted as { id?: string })?.id) keptIds.add((inserted as { id: string }).id)
    }
  }

  // Step 4: if departed ids — check contact_roles, then delete those with no roles
  const departed = existing.filter((c) => !keptIds.has(c.id)).map((c) => c.id)
  if (departed.length > 0) {
    const { data: rolesHeld } = await admin.from('contact_roles').select('contact_id').in('contact_id', departed)
    const holdsRole = new Set((rolesHeld ?? []).map((r: { contact_id: string }) => r.contact_id))
    const deletable = departed.filter((id) => !holdsRole.has(id))
    if (deletable.length > 0) {
      const { error } = await admin.from('contacts').delete().in('id', deletable)
      if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
    }
  }

  // Step 5: re-read contacts for the authoritative projection set
  const { data: finalRows } = await admin.from('contacts').select('*').eq('client_intake_id', intakeId).eq('relationship_type', 'child')
  const json = ((finalRows ?? []) as Array<Record<string, unknown>>).map(contactRowToDesignSheetChild)

  // Step 6: read design_sheets; if a row exists, overwrite design_sheets.children
  const { data: sheet } = await admin
    .from('design_sheets').select('id, decisions').eq('client_intake_id', intakeId).order('version', { ascending: false }).limit(1).maybeSingle()
  const sheetRow = sheet as { id?: string; decisions?: unknown } | null
  if (sheetRow?.id) {
    const decisions = (sheetRow.decisions && typeof sheetRow.decisions === 'object' && !Array.isArray(sheetRow.decisions))
      ? { ...(sheetRow.decisions as Record<string, unknown>) }
      : {}
    decisions.children = json
    const { error: dsErr } = await admin
      .from('design_sheets')
      .update({ children: json, decisions, updated_at: new Date().toISOString() })
      .eq('id', sheetRow.id)
    if (dsErr) throw new Error(`${dsErr.code ?? 'error'}: ${dsErr.message}`)
  }

  return { ids: Array.from(keptIds) }
}
