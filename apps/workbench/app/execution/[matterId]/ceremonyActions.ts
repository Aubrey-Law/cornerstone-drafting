'use server'

import { revalidatePath } from 'next/cache'
import { isStaffRole } from '@/lib/auth/gate'
import { saveCeremony, saveCeremonyDocument, type CeremonyStatus } from '@/lib/ceremony/repository'
import { DOCUMENT_KINDS, type DocumentKind } from '@/lib/execution/requirements'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

const text = (form: FormData, key: string): string | null =>
  String(form.get(key) ?? '').trim() || null

/**
 * Both actions check the session themselves. A server action is a public
 * endpoint: anything that can reach the app can post to it, so the page it was
 * rendered from having been gated proves nothing about the request.
 */
async function requireStaffUser() {
  const user = await getSessionUser()
  return user && isStaffRole(user.role) ? user : null
}

export async function recordCeremony(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  const user = await requireStaffUser()
  if (!user) return { message: 'You are not signed in as staff.' }

  const matterId = String(form.get('matterId') ?? '')
  if (!matterId) return { message: 'That form was missing its matter.' }

  const status = String(form.get('status') ?? 'scheduled')
  if (!['scheduled', 'completed', 'cancelled'].includes(status)) {
    return { message: 'Unknown ceremony status.' }
  }

  const result = await saveCeremony(getAdminClient(), {
    matterId,
    ceremonyId: text(form, 'ceremonyId'),
    scheduledFor: text(form, 'scheduledFor'),
    location: text(form, 'location'),
    notaryName: text(form, 'notaryName'),
    witnessOneName: text(form, 'witnessOneName'),
    witnessTwoName: text(form, 'witnessTwoName'),
    healthCareAgentName: text(form, 'healthCareAgentName'),
    status: status as CeremonyStatus,
    note: text(form, 'note'),
    userId: user.id,
  })

  if (!result.ok) return { message: result.message }
  revalidatePath(`/execution/${matterId}`)
  return { message: null }
}

export async function recordCeremonyDocument(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  const user = await requireStaffUser()
  if (!user) return { message: 'You are not signed in as staff.' }

  const ceremonyId = String(form.get('ceremonyId') ?? '')
  const documentKind = String(form.get('documentKind') ?? '')
  const matterId = String(form.get('matterId') ?? '')
  if (!ceremonyId) return { message: 'Save the appointment before recording documents.' }
  if (!(DOCUMENT_KINDS as readonly string[]).includes(documentKind)) {
    return { message: 'Unknown document kind.' }
  }

  const witnessCount = Number(form.get('witnessCount') ?? 0)
  if (!Number.isInteger(witnessCount) || witnessCount < 0 || witnessCount > 4) {
    return { message: 'Witness count must be a whole number between 0 and 4.' }
  }

  const result = await saveCeremonyDocument(getAdminClient(), {
    ceremonyId,
    documentKind: documentKind as DocumentKind,
    executed: form.get('executed') === 'on',
    signedOn: text(form, 'signedOn'),
    witnessCount,
    notarized: form.get('notarized') === 'on',
    recordedOn: text(form, 'recordedOn'),
    recordingReference: text(form, 'recordingReference'),
    note: text(form, 'documentNote'),
  })

  if (!result.ok) return { message: result.message }
  revalidatePath(`/execution/${matterId}`)
  return { message: null }
}
