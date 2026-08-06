import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { createLead } from '@/lib/leads/createLead'

export const CREATE_LEAD_TOOL_NAME = 'create_lead'

const CREATE_LEAD_TOOL: Anthropic.Tool = {
  name: CREATE_LEAD_TOOL_NAME,
  description:
    'Create a new lead after the attorney explicitly asks to create one. ' +
    'The client name and email are required. Never guess missing client information.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'The prospective client’s full name.' },
      client_email: { type: 'string', description: 'The prospective client’s email address.' },
      client_phone: { type: 'string', description: 'Optional phone number.' },
      practice_area: {
        type: 'string',
        enum: ['EP', 'EP-LP', 'Probate'],
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
  return `\n\nLEAD CREATION: You can create a lead with the \`${CREATE_LEAD_TOOL_NAME}\` tool. Use it only when the attorney explicitly asks to create or add a lead. A client name and email are required; ask for any missing required value and never invent it. Optional phone, practice area, and quoted fee may be omitted. After a successful tool result, confirm the lead was created and provide its returned admin URL. Do not call the tool more than once for the same request.`
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

    const created = await createLead({
      clientName,
      clientEmail,
      clientPhone: typeof fields.client_phone === 'string' ? fields.client_phone : null,
      practiceArea: typeof fields.practice_area === 'string' ? fields.practice_area : 'EP',
      feeQuoted: typeof fields.fee_quoted === 'number' ? fields.fee_quoted : null,
    })
    const url = `/admin/crm/opportunities/${created.leadId}`
    emit({
      tool: CREATE_LEAD_TOOL_NAME,
      tool_use_id: toolUseId,
      status: 'done',
      result: { lead_id: created.leadId, client_name: created.clientName, url },
    })
    return {
      content: JSON.stringify({
        ok: true,
        lead_id: created.leadId,
        client_name: created.clientName,
        client_email: created.clientEmail,
        practice_area: created.practiceArea,
        url,
      }),
    }
  },
}
