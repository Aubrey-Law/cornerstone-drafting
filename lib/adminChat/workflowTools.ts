import type Anthropic from '@anthropic-ai/sdk'
import { listWorkSkillsForUser } from '@/lib/works/list'
import { parseSkillMarkdown } from '@/lib/works/skill'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'

export const LIST_WORKFLOWS_TOOL_NAME = 'list_workflows'
export const READ_WORKFLOW_TOOL_NAME = 'read_workflow'

const LIST_WORKFLOWS_TOOL: Anthropic.Tool = {
  name: LIST_WORKFLOWS_TOOL_NAME,
  description:
    'List the attorney-approved workflows (reusable playbooks) available in the firm library. ' +
    'Returns id, name, description, type, and practice for each active workflow.',
  input_schema: { type: 'object', properties: {} },
}

const READ_WORKFLOW_TOOL: Anthropic.Tool = {
  name: READ_WORKFLOW_TOOL_NAME,
  description:
    'Read a workflow (playbook) from the firm library by id and get its full instructions. ' +
    'Call this immediately when the user message begins with a [Workflow: ...] tag, then follow the instructions.',
  input_schema: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The workflow id from the [Workflow: <title> (id: <id>)] tag or from list_workflows.',
      },
    },
    required: ['workflow_id'],
  },
}

/**
 * System-prompt block enabling the Mike-style workflow handoff: attach a
 * workflow in the composer → `[Workflow: ...]` prefix → model reads the
 * workflow body via tool and follows it.
 */
export function workflowSystemPromptNote() {
  return `\n\nWORKFLOWS: The firm keeps attorney-approved playbooks ("workflows") in a library. If the user message begins with \`[Workflow: <title> (id: <id>)]\`, immediately call \`${READ_WORKFLOW_TOOL_NAME}\` with that id and follow the workflow's instructions before doing anything else. Use \`${LIST_WORKFLOWS_TOOL_NAME}\` when the user asks what workflows exist or which one fits a task. Workflow output is always a draft for attorney review.`
}

export interface WorkflowToolUser {
  userId: string
  email: string | null
}

export function workflowToolExecutors(user: WorkflowToolUser): AdminChatToolExecutor[] {
  return [
    {
      tool: LIST_WORKFLOWS_TOOL,
      execute: async (_input, { toolUseId, emit }) => {
        const skills = await listWorkSkillsForUser(user.userId, user.email, { scope: 'all' })
        const workflows = skills.map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          type: skill.skill_type,
          practice: skill.practice,
        }))
        emit({
          tool: LIST_WORKFLOWS_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'done',
          result: { count: workflows.length },
        })
        return { content: JSON.stringify({ ok: true, workflows }) }
      },
    },
    {
      tool: READ_WORKFLOW_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        const { workflow_id: workflowId } = (input ?? {}) as { workflow_id?: unknown }
        if (typeof workflowId !== 'string' || !workflowId.trim()) {
          return { content: JSON.stringify({ ok: false, error: 'workflow_id is required' }), isError: true }
        }
        // Same visibility rules as the library list: own, system, or shared-with-me,
        // active only.
        const skills = await listWorkSkillsForUser(user.userId, user.email, { scope: 'all' })
        const skill = skills.find(candidate => candidate.id === workflowId.trim())
        if (!skill) {
          emit({
            tool: READ_WORKFLOW_TOOL_NAME,
            tool_use_id: toolUseId,
            status: 'error',
            error: 'Workflow not found or not available.',
          })
          return { content: JSON.stringify({ ok: false, error: 'Workflow not found or not available.' }), isError: true }
        }
        let body = skill.skill_md
        try {
          body = parseSkillMarkdown(skill.skill_md).body
        } catch {
          // Fall back to the raw stored markdown if frontmatter is malformed.
        }
        emit({
          workflow_applied: { workflow_id: skill.id, title: skill.name },
          tool: READ_WORKFLOW_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'done',
        })
        return {
          content: JSON.stringify({
            ok: true,
            workflow: { id: skill.id, title: skill.name, type: skill.skill_type },
            instructions: body,
          }),
        }
      },
    },
  ]
}
