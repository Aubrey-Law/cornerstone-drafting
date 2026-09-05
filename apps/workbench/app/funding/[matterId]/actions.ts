'use server'

import { revalidatePath } from 'next/cache'
import { isStaffRole } from '@/lib/auth/gate'
import { FUNDING_METHODS, FUNDING_STATUSES, type FundingMethod, type FundingStatus } from '@/lib/funding/model'
import { saveAssetFunding } from '@/lib/funding/repository'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

/**
 * Records one asset's funding state.
 *
 * Checks the session itself rather than trusting the page that rendered the
 * form. A server action is a public endpoint: anything that can reach the app
 * can post to it, so the proxy having gated the page it came from proves
 * nothing about the request.
 */
export async function recordAssetFunding(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  const user = await getSessionUser()
  if (!user || !isStaffRole(user.role)) return { message: 'You are not signed in as staff.' }

  const matterId = String(form.get('matterId') ?? '')
  const assetId = String(form.get('assetId') ?? '')
  const category = String(form.get('category') ?? '')
  const method = String(form.get('method') ?? '')
  const status = String(form.get('status') ?? '')
  const confirmedOn = String(form.get('confirmedOn') ?? '').trim() || null
  const note = String(form.get('note') ?? '').trim() || null

  if (!matterId || !assetId) return { message: 'That form was missing its asset.' }
  if (!(FUNDING_METHODS as readonly string[]).includes(method)) return { message: 'Unknown funding method.' }
  if (!(FUNDING_STATUSES as readonly string[]).includes(status)) return { message: 'Unknown status.' }

  const result = await saveAssetFunding(getAdminClient(), {
    matterId,
    assetId,
    category,
    method: method as FundingMethod,
    status: status as FundingStatus,
    confirmedOn,
    note,
    userId: user.id,
  })

  if (!result.ok) return { message: result.message }

  revalidatePath(`/funding/${matterId}`)
  revalidatePath('/funding')
  return { message: null }
}
