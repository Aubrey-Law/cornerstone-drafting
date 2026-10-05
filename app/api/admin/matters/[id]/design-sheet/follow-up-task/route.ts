import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { buildCompletionContext } from '@/lib/designSheetCompletion/context'
import {
  DESIGN_SHEET_FOLLOW_UP_BATCH_TAG,
  DESIGN_SHEET_FOLLOW_UP_TITLE,
  followUpDescription,
  followUpItems,
  mergeFollowUpChecklist,
} from '@/lib/designMeeting/followUpTask'
import type { ChecklistItem } from '@/lib/tasks/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

function readChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    return typeof raw.text === 'string' ? [{ text: raw.text, done: raw.done === true }] : []
  })
}

/**
 * Create, or refresh, the matter's design-sheet follow-up task.
 *
 * Reads only: the design sheet is never written here. The task is `manual`
 * because a person asked for it with a button, and it is tagged so the next
 * press finds and refreshes it instead of adding a second one.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params

  try {
    const context = await buildCompletionContext(matterId)
    const items = followUpItems(context.blocking, context.optional)

    const admin = getAdminClient()
    const { data: existing, error: findError } = await admin
      .from('tasks')
      .select('id, checklist')
      .eq('matter_id', matterId)
      .eq('batch_tag', DESIGN_SHEET_FOLLOW_UP_BATCH_TAG)
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (findError) throw new Error(findError.message)

    if (existing) {
      const checklist = mergeFollowUpChecklist(readChecklist(existing.checklist), items)
      const { error } = await admin
        .from('tasks')
        .update({
          checklist,
          description: followUpDescription(context.blocking.length, items.length),
        })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ status: 'updated', taskId: existing.id, openCount: items.length })
    }

    if (items.length === 0) {
      return NextResponse.json({ status: 'nothing_missing', taskId: null, openCount: 0 })
    }

    const { data, error } = await admin
      .from('tasks')
      .insert({
        matter_id: matterId,
        title: DESIGN_SHEET_FOLLOW_UP_TITLE,
        description: followUpDescription(context.blocking.length, items.length),
        status: 'open',
        priority: context.blocking.length > 0 ? 'high' : 'normal',
        source: 'manual',
        task_type: 'checklist',
        batch_tag: DESIGN_SHEET_FOLLOW_UP_BATCH_TAG,
        checklist: items.map(text => ({ text, done: false })),
        created_by: userId,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({ status: 'created', taskId: data.id, openCount: items.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the follow-up task'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
