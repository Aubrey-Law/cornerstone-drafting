import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { linkIntakeToMatter } from '@/lib/intake/linkIntakeToMatter'
import { MATTER_INTAKE_LINK_COLUMNS } from '@/lib/matters/matterIntakeLink'

type AdminClient = SupabaseClient<Database>

interface ResolveMatterIntakeArgs {
  matterId: string
  clientIntakeId: string | null
  leadId: string | null
  clientUserId?: string | null
  clientEmail?: string | null
  syncJobIntakeIds?: Array<string | null | undefined>
}

async function collectLeadIntakeIds(
  admin: AdminClient,
  leadId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('client_intake')
    .select('id')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) throw new Error(error.message)
  return (data ?? [])
    .map(row => row.id as string | undefined)
    .filter((id): id is string => Boolean(id))
}

async function collectClientUserIntakeIds(
  admin: AdminClient,
  clientUserId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('client_intake')
    .select('id')
    .or(`user_id.eq.${clientUserId},client_user_id.eq.${clientUserId}`)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) throw new Error(error.message)
  return (data ?? [])
    .map(row => row.id as string | undefined)
    .filter((id): id is string => Boolean(id))
}

async function collectEmailIntakeIds(
  admin: AdminClient,
  email: string,
): Promise<string[]> {
  const normalized = email.trim()
  if (!normalized) return []

  const { data, error } = await admin
    .from('client_intake')
    .select('id')
    .ilike('email', normalized)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) throw new Error(error.message)
  return (data ?? [])
    .map(row => row.id as string | undefined)
    .filter((id): id is string => Boolean(id))
}

async function collectAssetBackedIntakeIds(
  admin: AdminClient,
  candidateIds: string[],
): Promise<string[]> {
  const unique = [...new Set(candidateIds)]
  if (unique.length === 0) return []

  const { data, error } = await admin
    .from('asset_intake')
    .select('client_intake_id')
    .in('client_intake_id', unique)

  if (error) throw new Error(error.message)

  return [...new Set(
    (data ?? [])
      .map(row => row.client_intake_id as string | undefined)
      .filter((id): id is string => Boolean(id)),
  )]
}

async function pickBestIntakeId(
  admin: AdminClient,
  candidateIds: string[],
): Promise<string | null> {
  const unique = [...new Set(candidateIds)]
  if (unique.length === 0) return null

  const assetBacked = await collectAssetBackedIntakeIds(admin, unique)
  const preferred = assetBacked.length > 0 ? assetBacked : unique

  const { data, error } = await admin
    .from('client_intake')
    .select('id')
    .in('id', preferred)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data?.id as string | undefined) ?? preferred[0] ?? null
}

/**
 * Return the household intake for a matter, healing a missing or stale FK when
 * a newer intake exists via lead_id, client user, email, or intake_sync_jobs.
 */
export async function resolveMatterIntakeId(
  admin: AdminClient,
  {
    matterId,
    clientIntakeId,
    leadId,
    clientUserId = null,
    clientEmail = null,
    syncJobIntakeIds = [],
  }: ResolveMatterIntakeArgs,
): Promise<string | null> {
  const candidates: string[] = []
  if (clientIntakeId) candidates.push(clientIntakeId)

  if (leadId) {
    candidates.push(...await collectLeadIntakeIds(admin, leadId))
  }

  if (clientUserId) {
    candidates.push(...await collectClientUserIntakeIds(admin, clientUserId))
  }

  if (clientEmail) {
    candidates.push(...await collectEmailIntakeIds(admin, clientEmail))
  }

  const { data: syncJobs, error: syncError } = await admin
    .from('intake_sync_jobs')
    .select('client_intake_id')
    .eq('matter_id', matterId)
    .order('updated_at', { ascending: false })
    .limit(10)

  // Cornerstone Lite omits the intake_sync_jobs outbox table.
  if (!syncError) {
    for (const job of syncJobs ?? []) {
      const id = job.client_intake_id as string | null | undefined
      if (id) candidates.push(id)
    }
  }

  for (const id of syncJobIntakeIds) {
    if (id) candidates.push(id)
  }

  const intakeId = await pickBestIntakeId(admin, candidates)
  if (!intakeId) return null

  await linkIntakeToMatter(admin, matterId, intakeId)
  return intakeId
}

/** Load matter context from the database and resolve the linked intake id. */
export async function resolveMatterIntakeIdForMatter(
  admin: AdminClient,
  matterId: string,
): Promise<string | null> {
  const { data: matter, error } = await admin
    .from('matters')
    .select(MATTER_INTAKE_LINK_COLUMNS)
    .eq('id', matterId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!matter) return null

  const leadId = null

  return resolveMatterIntakeId(admin, {
    matterId,
    clientIntakeId: (matter.client_intake_id as string | null) ?? null,
    leadId,
    clientUserId: (matter.client_id as string | null) ?? null,
    clientEmail: null,
  })
}
