import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapMatterStageToEngine } from '@/lib/stage-engine/labels'
import { addBusinessDays } from '@/lib/stage-engine/businessDays'

type TaskTemplate = {
  stage_key: string
  fires_on: string
  track: string
  task: {
    title: string
    type: 'single' | 'checklist'
    soft_lead_days: number
    sla_days: number
    priority?: 'high' | 'normal' | 'low'
    checklist?: string[]
    batch_tag?: string
  }
}

type TemplatesFile = {
  templates: TaskTemplate[]
}

let cached: TemplatesFile | null = null

function loadTemplates(): TemplatesFile {
  if (cached) return cached
  const raw = readFileSync(resolve(process.cwd(), 'config/stage-task-templates.json'), 'utf-8')
  cached = JSON.parse(raw) as TemplatesFile
  return cached
}

const ATTORNEY_ENGINE_STAGES = new Set([
  'proposal_ea_out',
  'drafting',
  'revisions',
  'closeout',
])

/**
 * Create a `tasks` row (source = 'stage') when a matter enters an attorney-owned
 * engine stage. Idempotent on (matter_id, stage_key, stage_entered_at).
 */
export async function fireEngineStageTask(
  admin: SupabaseClient,
  args: {
    matterId: string
    matterStage: string
    clientName?: string | null
    revisionRound?: number
  },
): Promise<void> {
  const engineStage = mapMatterStageToEngine(args.matterStage)
  if (!engineStage || !ATTORNEY_ENGINE_STAGES.has(engineStage)) return

  const { data: matter } = await admin
    .from('matters')
    .select('stage_entered_at, client_name, revision_round')
    .eq('id', args.matterId)
    .maybeSingle()

  if (!matter?.stage_entered_at) return

  const template = loadTemplates().templates.find(t => t.stage_key === engineStage)
  if (!template) return

  const clientName = args.clientName ?? matter.client_name ?? 'Client'
  const reviewRound = String(args.revisionRound ?? matter.revision_round ?? 1)
  const title = template.task.title
    .replace('{client_name}', clientName)
    .replace('{review_round}', reviewRound)
    .replace('{matter_id}', args.matterId)

  const enteredAt = new Date(matter.stage_entered_at as string)
  const softDue = addBusinessDays(enteredAt, template.task.soft_lead_days)
  const hardDue = addBusinessDays(enteredAt, template.task.sla_days)

  const checklist = (template.task.checklist ?? []).map(text => ({ text, done: false }))

  const { error } = await admin.from('tasks').upsert(
    {
      matter_id: args.matterId,
      source: 'stage',
      stage_key: engineStage,
      stage_entered_at: matter.stage_entered_at,
      title,
      task_type: template.task.type,
      soft_due_at: softDue.toISOString(),
      hard_due_at: hardDue.toISOString(),
      // Stage tasks work off their soft date; hard_due_at stays the SLA badge.
      due_at: softDue.toISOString(),
      priority: template.task.priority ?? 'normal',
      status: 'open',
      batch_tag: template.task.batch_tag ?? null,
      checklist,
    },
    { onConflict: 'matter_id,stage_key,stage_entered_at', ignoreDuplicates: true },
  )

  if (error) {
    console.error('fireEngineStageTask:', error.message)
  }
}

export async function archiveEngineStageTasks(
  admin: SupabaseClient,
  matterId: string,
  engineStage: string,
): Promise<void> {
  await admin
    .from('tasks')
    .update({ status: 'archived' })
    .eq('matter_id', matterId)
    .eq('source', 'stage')
    .eq('stage_key', engineStage)
    .eq('status', 'open')
}
