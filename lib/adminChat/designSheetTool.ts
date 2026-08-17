import type Anthropic from '@anthropic-ai/sdk'
import { parseDesignSheetImportText } from '@/lib/designSheetImport/server'
import { buildCompletionContext } from '@/lib/designSheetCompletion/context'
import {
  DESIGN_SHEET_IMPORT_TOOL_NAME,
  DESIGN_SHEET_STATUS_TOOL_NAME,
  type AdminChatToolExecutor,
} from '@/lib/adminChat/engine'

export const DESIGN_SHEET_IMPORT_TOOL: Anthropic.Tool = {
  name: DESIGN_SHEET_IMPORT_TOOL_NAME,
  description:
    'Parse attorney-provided pasted or typed text into proposed design-sheet field updates for the current matter. ' +
    'The tool returns preview rows and a proposed field map only; it does not write to the database.',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Raw pasted or typed design-sheet text to parse. Do not summarize before passing it.',
      },
    },
    required: ['text'],
  },
}

export function designSheetImportExecutor(matterId: string, userId: string | null): AdminChatToolExecutor {
  return {
    tool: DESIGN_SHEET_IMPORT_TOOL,
    execute: async (input, { toolUseId, emit }) => {
      const { text } = (input ?? {}) as { text?: unknown }
      const result = await parseDesignSheetImportText({
        matterId,
        text: typeof text === 'string' ? text : '',
        userId: userId ?? '',
      })
      emit({
        tool: DESIGN_SHEET_IMPORT_TOOL_NAME,
        tool_use_id: toolUseId,
        status: 'done',
        result: {
          matter_id: matterId,
          proposed: result.proposed,
          preview: result.preview,
        },
      })
      return {
        content: JSON.stringify({
          ok: true,
          proposed_field_count: result.preview.length,
          message: 'Design sheet updates are ready for attorney review in the UI. They have not been saved.',
        }),
      }
    },
  }
}

export const DESIGN_SHEET_STATUS_TOOL: Anthropic.Tool = {
  name: DESIGN_SHEET_STATUS_TOOL_NAME,
  description:
    'List what the current matter\'s design sheet is still missing: the required items blocking ' +
    'document generation and the optional ones, each with its design-sheet section. ' +
    'Call this before asking the attorney design-sheet questions, so you ask only about what is ' +
    'actually open. Read-only.',
  input_schema: { type: 'object', properties: {} },
}

/**
 * What the sheet still needs, straight from the readiness engine.
 *
 * The assistant used to have no way to ask this, so an interview either re-asked
 * settled questions or guessed which ones mattered. Readiness already computes
 * the answer for the workspace's own progress rail; this just hands it over.
 */
export function designSheetStatusExecutor(matterId: string): AdminChatToolExecutor {
  return {
    tool: DESIGN_SHEET_STATUS_TOOL,
    execute: async (_input, { toolUseId, emit }) => {
      try {
        const context = await buildCompletionContext(matterId)
        const shape = (item: { label: string; sectionLabel: string; targetField: string | null }) => ({
          item: item.label,
          section: item.sectionLabel,
          field: item.targetField,
        })

        const result = {
          ready_to_generate: context.readinessComplete,
          blocking: context.blocking.map(shape),
          optional: context.optional.map(shape),
        }

        emit({
          tool: DESIGN_SHEET_STATUS_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'done',
          result: { blocking_count: result.blocking.length, optional_count: result.optional.length },
        })
        return { content: JSON.stringify({ ok: true, ...result }) }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read design sheet status'
        emit({
          tool: DESIGN_SHEET_STATUS_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'error',
          error: message,
        })
        return { content: JSON.stringify({ ok: false, error: message }), isError: true }
      }
    },
  }
}
