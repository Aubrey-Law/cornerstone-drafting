import { getAdminClient } from '@/lib/supabaseAdmin'

export type MatterRef = { kind: 'matter' | 'number' | 'design-sheet' | 'intake'; value: string }
export type ResolvedMatter = { matterId: string; source: MatterRef['kind'] }
/**
 * `includeLeads` widens the lookup to an opportunity's matters row.
 *
 * Drafting is retained-client work, so resolution is hired-only by default and
 * a lead's id reads as "no such matter". The pre-engagement clock is the
 * exception: the discovery call and the PMPS are recorded on a lead, against
 * the same matters row, and saving one answered "Matter not found" until this
 * existed. Callers that would act on drafting data must leave it off.
 */
export type ResolveMatterOptions = { includeLeads?: boolean }
export class MatterReferenceNotFoundError extends Error {
  constructor() { super('Matter not found'); this.name = 'MatterReferenceNotFoundError' }
}
type Admin = ReturnType<typeof getAdminClient>
async function row<T>(query: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T | null> {
  const result = await query
  // Legacy URLs can be a matter number rather than a UUID. A UUID cast miss
  // is a reference mismatch; connection, permission and schema errors are not.
  if (result.error?.code === '22P02') return null
  if (result.error) throw new Error(`Matter lookup unavailable: ${result.error.message}`)
  return result.data
}

export async function resolveMatterRef(ref: MatterRef, admin: Admin = getAdminClient(), options: ResolveMatterOptions = {}): Promise<ResolvedMatter | null> {
  if (!ref.value.trim()) return null
  if (ref.kind === 'design-sheet') {
    const sheet = await row<{ matter_id: string }>(admin.from('design_sheets').select('matter_id').eq('id', ref.value).maybeSingle())
    if (!sheet?.matter_id) return null
    const resolved = await resolveMatterRef({ kind: 'matter', value: sheet.matter_id }, admin, options)
    return resolved ? { ...resolved, source: ref.kind } : null
  }
  const column = ref.kind === 'matter' ? 'id' : ref.kind === 'number' ? 'matter_number' : 'client_intake_id'
  const query = admin.from('matters').select('id').eq(column, ref.value)
  const matter = await row<{ id: string }>(
    (options.includeLeads ? query : query.eq('relationship_status', 'hired')).maybeSingle(),
  )
  return matter?.id ? { matterId: matter.id, source: ref.kind } : null
}

/** Compatibility for existing external URLs. Successful precedence is unchanged. */
export async function resolveMatterId(inputId: string, admin: Admin = getAdminClient(), options: ResolveMatterOptions = {}): Promise<string> {
  for (const kind of ['matter', 'number', 'design-sheet'] as const) {
    const resolved = await resolveMatterRef({ kind, value: inputId }, admin, options)
    if (resolved) return resolved.matterId
  }
  const legacySheet = await row<{ client_intake_id: string | null }>(admin.from('design_sheets').select('client_intake_id').eq('matter_id', inputId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle())
  if (legacySheet?.client_intake_id) {
    const resolved = await resolveMatterRef({ kind: 'intake', value: legacySheet.client_intake_id }, admin, options)
    if (resolved) return resolved.matterId
  }
  const intake = await resolveMatterRef({ kind: 'intake', value: inputId }, admin, options)
  if (intake) return intake.matterId
  const legacyIntake = await row<{ id: string }>(admin.from('client_intake').select('id').eq('matter_id', inputId).maybeSingle())
  if (legacyIntake?.id) {
    const resolved = await resolveMatterRef({ kind: 'intake', value: legacyIntake.id }, admin, options)
    if (resolved) return resolved.matterId
  }
  throw new MatterReferenceNotFoundError()
}
