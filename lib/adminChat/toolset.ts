import type { AdminChatToolExecutor, ChatContextType } from '@/lib/adminChat/engine'
import { designSheetImportExecutor, designSheetStatusExecutor } from '@/lib/adminChat/designSheetTool'
import { workflowToolExecutors, workflowSystemPromptNote } from '@/lib/adminChat/workflowTools'
import { createLeadToolExecutor, leadSystemPromptNote } from '@/lib/adminChat/leadTools'
import { exportLeadsToolExecutor, leadExportSystemPromptNote } from '@/lib/adminChat/leadExportTool'
import { exportMattersToolExecutor, matterExportSystemPromptNote } from '@/lib/adminChat/matterExportTool'
import { calendarPlanningSystemPromptNote, calendarPlanningToolExecutors } from '@/lib/adminChat/calendarTools'
import { templateBuilderSystemPromptNote, templateBuilderToolExecutors } from '@/lib/templateBuilder/assistantTools'
import { matterKnowledgeSystemPromptNote, matterKnowledgeToolExecutors } from '@/lib/adminChat/matterKnowledgeTools'
import { firmTodaySystemPromptNote, firmTodayToolExecutor } from '@/lib/adminChat/firmTodayTool'

export interface AdminChatToolsetOptions {
  contextType: ChatContextType
  /** The matter id for a matter chat, the client_intake id for a lead chat. */
  contextId: string | null
  user: {
    id: string
    email?: string | null
    user_metadata?: Record<string, unknown>
  }
  /**
   * Which chat surface is asking. The Assistant page is where Template Builder
   * uploads arrive, so only it carries those tools. The Word add-in's pane can
   * render text but not a proposal card or a download, so it gets the
   * read-only tools only; everything else is common to the page and the rail.
   */
  surface: 'assistant' | 'rail' | 'addin'
}

export interface AdminChatToolset {
  tools: AdminChatToolExecutor[]
  /** The system-prompt blocks that describe the registered tools, in one string. */
  promptNotes: string
}

/**
 * The one tool list both chat surfaces register.
 *
 * Each route used to assemble its own and they drifted: the Assistant page
 * never had read_design_sheet_status although its matter prompt told the
 * model to call it, and its calendar tools had no default matter or actor.
 * Building both from here keeps the prompt's promises and the tool list equal.
 */
export function adminChatToolset(options: AdminChatToolsetOptions): AdminChatToolset {
  const { contextType, contextId, user, surface } = options
  const matterId = contextType === 'matter' ? contextId : null
  const leadId = contextType === 'lead' ? contextId : null
  const workflowUser = { userId: user.id, email: user.email ?? null }

  if (surface === 'addin') {
    const tools: AdminChatToolExecutor[] = [
      ...(matterId ? [designSheetStatusExecutor(matterId)] : []),
      ...workflowToolExecutors(workflowUser),
      firmTodayToolExecutor,
      ...matterKnowledgeToolExecutors({ defaultRecordId: contextId }),
    ]
    const promptNotes = workflowSystemPromptNote() + firmTodaySystemPromptNote() + matterKnowledgeSystemPromptNote()
    return { tools, promptNotes }
  }

  const tools: AdminChatToolExecutor[] = [
    createLeadToolExecutor,
    exportLeadsToolExecutor,
    exportMattersToolExecutor,
    ...(matterId
      ? [designSheetImportExecutor(matterId, user.id), designSheetStatusExecutor(matterId)]
      : []),
    ...workflowToolExecutors(workflowUser),
    ...calendarPlanningToolExecutors({ defaultMatterId: matterId, defaultLeadId: leadId, actor: user }),
    ...(surface === 'assistant' ? templateBuilderToolExecutors(user.id) : []),
    firmTodayToolExecutor,
    // A lead is matter-owned, so its record reads by the same id.
    ...matterKnowledgeToolExecutors({ defaultRecordId: contextId }),
  ]

  const promptNotes = workflowSystemPromptNote()
    + leadSystemPromptNote()
    + leadExportSystemPromptNote()
    + matterExportSystemPromptNote()
    + calendarPlanningSystemPromptNote()
    + (surface === 'assistant' ? templateBuilderSystemPromptNote() : '')
    + firmTodaySystemPromptNote()
    + matterKnowledgeSystemPromptNote()

  return { tools, promptNotes }
}
