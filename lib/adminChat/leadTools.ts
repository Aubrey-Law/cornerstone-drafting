import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { proposeWrite } from '@/lib/adminChat/proposals'

export const CREATE_LEAD_TOOL_NAME = 'create_lead'

const CREATE_LEAD_TOOL: Anthropic.Tool = {
  name: CREATE_LEAD_TOOL_NAME,
  description:
    'Propose a new lead after the attorney explicitly asks to create one. The lead is not created until the attorney accepts the proposal. ' +
    'The client name and email are required. Never guess missing client information.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'The prospective client’s full name.' },
      client_email: { type: 'string', description: 'The prospective client’s email address.' },
      client_phone: { type: 'string', description: 'Optional phone number.' },
      practice_area: {
        type: 'string',
        enum: ['EP', 'EP-LP', 'Probate', 'TA'],
        description: 'Practice area. Defaults to EP when the attorney does not specify one.',
      },
      fee_quoted: {
        type: 'number',
        description: 'Optional quoted fee in dollars.',
      },
    },
    required: ['client_name', 'client_email'],
  },
}

export function leadSystemPromptNote() {
  return `\n\nLEAD CREATION: You can propose a lead with the \`${CREATE_LEAD_TOOL_NAME}\` tool. Use it only when the attorney explicitly asks to create or add a lead. A client name and email are required; ask for any missing required value and never invent it. Optional phone, practice area, and quoted fee may be omitted. The tool only proposes: the lead is created when the attorney presses accept on the proposal card. Never say a lead was created — say you have proposed it and it needs their acceptance. Do not call the tool more than once for the same request.`
}

export const createLeadToolExecutor: AdminChatToolExecutor = {
  tool: CREATE_LEAD_TOOL,
  execute: async (input, { toolUseId, emit }) => {
    const fields = (input ?? {}) as Record<string, unknown>
    const clientName = typeof fields.client_name === 'string' ? fields.client_name.trim() : ''
    const clientEmail = typeof fields.client_email === 'string' ? fields.client_email.trim() : ''
    if (!clientName || !clientEmail) {
      return {
        content: JSON.stringify({ ok: false, error: 'client_name and client_email are required' }),
        isError: true,
      }
    }

    return proposeWrite({
      kind: 'create_lead',
      toolName: CREATE_LEAD_TOOL_NAME,
      toolUseId,
      emit,
      title: `Create lead: ${clientName}`,
      rationale: clientEmail,
      payload: {
        client_name: clientName,
        client_email: clientEmail,
        client_phone: typeof fields.client_phone === 'string' ? fields.client_phone : null,
        practice_area: typeof fields.practice_area === 'string' ? fields.practice_area : 'EP',
        fee_quoted: typeof fields.fee_quoted === 'number' ? fields.fee_quoted : null,
      },
    })
  },
}
