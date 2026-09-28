'use server'

import { revalidatePath } from 'next/cache'
import { saveCeremony, saveCeremonyDocument, type CeremonyStatus } from '@/lib/ceremony/repository'
import { DOCUMENT_KINDS, type DocumentKind } from '@/lib/execution/requirements'
import { reviewClient } from '@/lib/review/staff'
import { requireAdminServerAction } from '@/lib/serverActionAuth'

const text = (form: FormData, key: string): string | null =>
  String(form.get(key) ?? '').trim() || null

/**
 * Both actions check the caller themselves: a server action is a public
 * endpoint whether or not the page that rendered its form was gated.
 */

export async function recordCeremony(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  let userId: string
  try {
    userId = await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

  const matterId = String(form.get('matterId') ?? '')
  if (!matterId) return { message: 'That form was missing its matter.' }

  const status = String(form.get('status') ?? 'scheduled')
  if (!['scheduled', 'completed', 'cancelled'].includes(status)) {
    return { message: 'Unknown ceremony status.' }
  }

  const result = await saveCeremony(reviewClient(), {
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
    userId,
  })

  if (!result.ok) return { message: result.message }
  revalidatePath('/admin/execution')
  return { message: null }
}

export async function recordCeremonyDocument(
  _previous: { message: string | null } | null,
  form: FormData,
): Promise<{ message: string | null }> {
  try {
    await requireAdminServerAction()
  } catch {
    return { message: 'You are not signed in as staff.' }
  }

  const ceremonyId = String(form.get('ceremonyId') ?? '')
  const documentKind = String(form.get('documentKind') ?? '')
  const matterId = String(form.get('matterId') ?? '')
  if (!matterId) return { message: 'That form was missing its matter.' }
  if (!ceremonyId) return { message: 'Save the appointment before recording documents.' }
  if (!(DOCUMENT_KINDS as readonly string[]).includes(documentKind)) {
    return { message: 'Unknown document kind.' }
  }

  const witnessCount = Number(form.get('witnessCount') ?? 0)
  if (!Number.isInteger(witnessCount) || witnessCount < 0 || witnessCount > 4) {
    return { message: 'Witness count must be a whole number between 0 and 4.' }
  }

  const result = await saveCeremonyDocument(reviewClient(), {
    matterId,
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
  revalidatePath('/admin/execution')
  return { message: null }
}
