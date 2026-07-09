'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export interface MatterNoteRow {
  id: string
  matter_id: string
  note_type: string
  body: string
  author: string | null
  created_at: string
}

export async function addMatterNote(
  matterId: string,
  content: string,
  type: 'internal' | 'client_comm' = 'internal',
): Promise<MatterNoteRow> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_notes')
    .insert({ matter_id: matterId, body: content, note_type: type })
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/matters/${matterId}`)
  return data as MatterNoteRow
}

export async function updateMatterNote(
  matterId: string,
  noteId: string,
  content: string,
  type: 'internal' | 'client_comm' = 'internal',
): Promise<MatterNoteRow> {
  await requireAdminServerAction()
  const body = content.trim()
  if (!body) throw new Error('Note cannot be blank.')

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_notes')
    .update({ body, note_type: type })
    .eq('id', noteId)
    .eq('matter_id', matterId)
    .in('note_type', ['internal', 'client_comm'])
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/matters/${matterId}`)
  return data as MatterNoteRow
}

export async function deleteMatterNote(
  matterId: string,
  noteId: string,
): Promise<{ id: string }> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_notes')
    .delete()
    .eq('id', noteId)
    .eq('matter_id', matterId)
    .in('note_type', ['internal', 'client_comm'])
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/matters/${matterId}`)
  return data
}

export async function updateMatterStatus(matterId: string, status: string): Promise<void> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const { error } = await admin.from('matters').update({ status }).eq('id', matterId)
  if (error) throw new Error(error.message)

  await admin
    .from('matter_details')
    .upsert({ client_id: matterId, client_status: status }, { onConflict: 'client_id' })

  revalidatePath(`/admin/matters/${matterId}`)
}
