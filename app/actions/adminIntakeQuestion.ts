'use server'

import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { saveStaffQuestionRow } from '@/lib/intake/forms/staffQuestionEditing'
import type { StaffQuestionEdit } from '@/lib/intake/forms/staffEditableFields'

export async function saveAdminIntakeQuestion(args: StaffQuestionEdit): Promise<void> {
  await requireAdminServerAction()
  await saveStaffQuestionRow(getAdminClient(), args)
}
