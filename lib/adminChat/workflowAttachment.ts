import { listWorkSkillsForUser } from '@/lib/works/list'
import { parseSkillMarkdown } from '@/lib/works/skill'
import { loadSystemSkillBody } from '@/lib/works/systemSkills'
import type { ChatContextType } from '@/lib/adminChat/engine'
import { FIND_MATTER_TOOL_NAME, READ_MATTER_RECORD_TOOL_NAME } from '@/lib/adminChat/matterKnowledgeTools'
import { READ_WORKFLOW_TOOL_NAME } from '@/lib/adminChat/workflowTools'

/**
 * A workflow the attorney attached to a message, resolved to the text the
 * model should follow this turn.
 *
 * The composer used to hand the model only a `[Workflow: …]` tag and rely on
 * it choosing to call `read_workflow`. In the firm's own history it did not,
 * roughly one time in four. The route now loads the body itself and puts it
 * in the system prompt, so following the workflow is no longer optional.
 */
export interface AttachedWorkflow {
  id: string
  title: string
  body: string
  executionMode: 'chat' | 'run'
  allowedContext: string[]
}

export interface AttachedWorkflowUser {
  userId: string
  email: string | null
}

/**
 * Resolve an attached workflow under the same visibility rules as the Library
 * list: own, system, or shared with me, active only. Returns null when the
 * attorney cannot see it.
 *
 * A system workflow's body comes from the bundled SKILL.md, not the synced
 * `work_skills` row: the row is a copy that lags behind the code until someone
 * re-syncs, and the deployed file is by definition the current version.
 */
export async function loadAttachedWorkflow(
  workflowId: string,
  user: AttachedWorkflowUser,
): Promise<AttachedWorkflow | null> {
  const skills = await listWorkSkillsForUser(user.userId, user.email, { scope: 'all' })
  const skill = skills.find(candidate => candidate.id === workflowId)
  if (!skill) return null

  let body: string | null = null
  if (skill.is_system && skill.slug) {
    try {
      body = await loadSystemSkillBody(skill.slug)
    } catch {
      // Not in the bundle any more (deactivated system skill) — fall through
      // to whatever the row holds.
    }
  }
  if (body === null) {
    try {
      body = parseSkillMarkdown(skill.skill_md).body
    } catch {
      body = skill.skill_md
    }
  }

  return {
    id: skill.id,
    title: skill.name,
    body,
    executionMode: skill.execution_mode,
    allowedContext: Array.isArray(skill.allowed_context) ? skill.allowed_context : [],
  }
}

/**
 * The system-prompt block for an attached workflow.
 *
 * Every matter-scoped workflow is written as if a matter were already in
 * context. On the Assistant page it usually is not, so this block tells a
 * general chat to resolve the matter through the record tools first instead
 * of asking the attorney to retype what the app already holds.
 */
export function attachedWorkflowPromptNote(
  workflow: Pick<AttachedWorkflow, 'title' | 'body' | 'executionMode' | 'allowedContext'>,
  options: { contextType: ChatContextType },
): string {
  const lines: string[] = [
    `\n\nATTACHED WORKFLOW — "${workflow.title}": The attorney attached this workflow to their message. Follow its instructions for this turn. Its full text is below, so do not call \`${READ_WORKFLOW_TOOL_NAME}\` for it.`,
  ]

  if (workflow.executionMode === 'run') {
    lines.push(
      `This workflow is built for the Library's "Dedicated run", which loads the matter snapshot and assembles the documents deterministically. In chat you can only explain what it needs and gather missing facts; do not claim to have generated its documents. Point the attorney to the Library → this workflow → Dedicated run to produce them.`,
    )
  }

  if (workflow.allowedContext.includes('matter') && options.contextType === 'general') {
    lines.push(
      `This workflow needs a matter and none is loaded in this chat. Before following it: if the attorney named a client or matter, call \`${FIND_MATTER_TOOL_NAME}\` and then \`${READ_MATTER_RECORD_TOOL_NAME}\` (overview, people, notes, tasks at minimum) and treat that record as "the matter context". If several records match, ask which one. If no client was named, ask which matter this is for before doing anything else. Never ask the attorney to retype facts the record already holds.`,
    )
  }

  lines.push(`Workflow instructions:\n${workflow.body}`)
  return lines.join('\n\n')
}
