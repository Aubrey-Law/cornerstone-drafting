'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'
import { saveScanDisposition, SCAN_DISPOSITIONS, type ScanDisposition } from '@/lib/review/scans'

/**
 * The saved-check page's one write: a decision on an item. Checks the caller
 * itself, as every server action must — the page being gated proves nothing
 * about the request.
 */
export async function recordScanDisposition(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

  const itemId = String(form.get('itemId') ?? '')
  const scanId = String(form.get('scanId') ?? '')
  const disposition = String(form.get('disposition') ?? '')
  const note = String(form.get('note') ?? '').trim() || null

  if (!itemId) return { message: 'That form was missing its item.' }
  if (!SCAN_DISPOSITIONS.includes(disposition as ScanDisposition)) return { message: 'Unknown decision.' }

  const result = await saveScanDisposition(getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>, {
    item: { itemId },
    disposition: disposition as ScanDisposition,
    note,
    userId,
  })
  if (!result.ok) return { message: result.message }

  revalidatePath(`/admin/review/scans/${scanId}`)
  return { message: null }
}
