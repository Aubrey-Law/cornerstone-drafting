import type Anthropic from '@anthropic-ai/sdk'
import { parseDesignSheetImportText } from '@/lib/designSheetImport/server'
import { DESIGN_SHEET_IMPORT_TOOL_NAME, type AdminChatToolExecutor } from '@/lib/adminChat/engine'

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
