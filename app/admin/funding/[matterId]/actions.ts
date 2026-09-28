'use server'

import { revalidatePath } from 'next/cache'
import { FUNDING_METHODS, FUNDING_STATUSES, type FundingMethod, type FundingStatus } from '@/lib/funding/model'
import { saveAssetFunding } from '@/lib/funding/repository'
import { reviewClient } from '@/lib/review/staff'
import { requireAdminServerAction } from '@/lib/serverActionAuth'

export interface FundingFormState {
  message: string | null
}

/**
 * Records one asset's funding state. Checks the caller itself: a server
 * action is a public endpoint whether or not the page that rendered the form
 * was gated.
 */
export async function recordAssetFunding(
  _previous: FundingFormState | null,
  form: FormData,
): Promise<FundingFormState> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

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

  const result = await saveAssetFunding(reviewClient(), {
    matterId,
    assetId,
    category,
    method: method as FundingMethod,
    status: status as FundingStatus,
    confirmedOn,
    note,
    userId,
  })

  if (!result.ok) return { message: result.message }

  revalidatePath(`/admin/funding/${matterId}`)
  revalidatePath('/admin/funding')
  return { message: null }
}
