import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { fetchLeadExportRows } from '@/lib/queries/leadList'
import {
  LEAD_PROGRESS_FILTERS,
  LEAD_STATUS_FILTERS,
  leadListParamsFrom,
} from '@/lib/leads/listParams'
import { clampLeadExportLimit, leadExportFilename } from '@/lib/leads/exportRows'

export const EXPORT_LEADS_TOOL_NAME = 'export_leads'

/**
 * How many leads come back in the tool result itself.
 *
 * The rows are read into the model's context, so this is deliberately smaller
 * than the CSV's ceiling: a request for "every lead" gets a complete download
 * and an honest count, not two thousand rows of contact data pasted into a
 * conversation.
 */
const INLINE_ROW_LIMIT = 200

const EXPORT_LEADS_TOOL: Anthropic.Tool = {
  name: EXPORT_LEADS_TOOL_NAME,
  description:
    'Export the firm\'s leads as a contact list — name, email and phone for each one. ' +
    'Use it whenever the attorney asks for a list, export, or spreadsheet of leads, or for ' +
    'their contact details. Filters match the leads list: status, practice area, intake or ' +
    'engagement progress, and a free-text search over name, email, phone and practice area. ' +
    'Returns the rows plus a CSV download link. Read-only.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: [...LEAD_STATUS_FILTERS],
        description:
          'Which leads to include: open (still in the pipeline, the default), lost, declined, or all.',
      },
      search: {
        type: 'string',
        description:
          'Optional free-text filter over name, email, phone and practice area.',
      },
      practice_area: {
        type: 'string',
        description: 'Optional practice area code to filter by, e.g. EP, EP-LP or Probate.',
      },
      progress: {
        type: 'string',
        enum: [...LEAD_PROGRESS_FILTERS],
        description:
          'Optional intake/engagement stage filter: intake_not_sent, intake_pending, ' +
          'intake_complete, engagement_pending or engagement_signed.',
      },
      limit: {
        type: 'number',
        description:
          `Maximum rows to return in the result (1-${INLINE_ROW_LIMIT}). Defaults to ${INLINE_ROW_LIMIT}. ` +
          'The CSV download always covers the whole filtered set.',
      },
    },
  },
}

export function leadExportSystemPromptNote() {
  return `\n\nLEAD EXPORT: Call \`${EXPORT_LEADS_TOOL_NAME}\` when the attorney asks for a list, export, or spreadsheet of leads, or for leads' contact details. It returns each lead's name, email and phone, plus a CSV download link. Default to open leads unless they ask for lost, declined, or all. Present the rows as a compact markdown table (Name | Email | Phone) and mention the download link. Leave a missing email or phone blank rather than inventing one. If the result reports \`truncated: true\`, say how many leads matched in total and that the CSV holds the full set.`
}

export const exportLeadsToolExecutor: AdminChatToolExecutor = {
  tool: EXPORT_LEADS_TOOL,
  execute: async (input, { toolUseId, emit }) => {
    const fields = (input ?? {}) as Record<string, unknown>
    const params = leadListParamsFrom(
      {
        status: fields.status,
        search: fields.search,
        practice: fields.practice_area,
        progress: fields.progress,
      },
      { sort: 'name_asc' },
    )
    const limit = Math.min(
      INLINE_ROW_LIMIT,
      fields.limit === undefined ? INLINE_ROW_LIMIT : clampLeadExportLimit(fields.limit),
    )

    try {
      const page = await fetchLeadExportRows(params, { limit })
      const downloadUrl = `/api/admin/leads/export?${new URLSearchParams({
        status: params.status,
        ...(params.search ? { search: params.search } : {}),
        ...(params.practice && params.practice !== 'all' ? { practice: params.practice } : {}),
        ...(params.progress !== 'all' ? { progress: params.progress } : {}),
        sort: params.sort,
      }).toString()}`
      const filename = leadExportFilename(params.status)

      emit({
        tool: EXPORT_LEADS_TOOL_NAME,
        tool_use_id: toolUseId,
        status: 'done',
        result: {
          lead_count: page.total,
          filename,
          download_url: downloadUrl,
        },
      })

      return {
        content: JSON.stringify({
          ok: true,
          filters: {
            status: params.status,
            search: params.search || null,
            practice_area: params.practice,
            progress: params.progress,
          },
          returned: page.rows.length,
          total_matching: page.total,
          truncated: page.truncated,
          download_url: downloadUrl,
          leads: page.rows.map(({ name, email, phone }) => ({ name, email, phone })),
        }),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lead export failed'
      emit({ tool: EXPORT_LEADS_TOOL_NAME, tool_use_id: toolUseId, status: 'error', error: message })
      return { content: JSON.stringify({ ok: false, error: message }), isError: true }
    }
  },
}
