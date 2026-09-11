import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { clampMatterExportLimit, fetchMatterExportRows } from '@/lib/queries/matters'
import {
  MATTER_SORT_KEYS,
  MATTER_STAGE_GROUPS,
  matterSortKeyFrom,
  matterTableFiltersFrom,
} from '@/lib/adminTables/matterTable'
import { STAGE_GROUP_LABELS } from '@/lib/matter/stageGroups'
import {
  matterExportFilename,
  matterExportLabel,
  matterExportUrl,
} from '@/lib/matters/exportRows'

export const EXPORT_MATTERS_TOOL_NAME = 'export_matters'

/**
 * How many matters come back in the tool result itself.
 *
 * Smaller than the CSV's ceiling, for the same reason the lead export is: a
 * request for "every matter" should produce a complete file and an honest
 * count, not the whole client list pasted into a conversation.
 */
const INLINE_ROW_LIMIT = 200

const STAGE_GROUP_LIST = MATTER_STAGE_GROUPS
  .map(group => `${group} (${STAGE_GROUP_LABELS[group]})`)
  .join(', ')

const EXPORT_MATTERS_TOOL: Anthropic.Tool = {
  name: EXPORT_MATTERS_TOOL_NAME,
  description:
    'Export the firm\'s open matters as a list — client, email, phone, matter number, matter name, ' +
    'practice area, stage, intake status, fee and last milestone date for each one. ' +
    'Use it whenever the attorney asks for a list, export, or spreadsheet of matters or active ' +
    'clients. Filters match the matters list: a free-text search over client, matter number, ' +
    'matter name, email, phone, practice area and stage; a practice area; and a stage group. ' +
    'Closed and archived matters are left out unless include_closed is true. ' +
    'Returns the rows plus a CSV download link. Read-only.',
  input_schema: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description:
          'Optional free-text filter over client name, matter number, matter name, email, phone, ' +
          'practice area, stage and intake status.',
      },
      practice_area: {
        type: 'string',
        description: 'Optional practice area code to filter by, e.g. EP, EP-LP or Probate.',
      },
      stage_group: {
        type: 'string',
        enum: [...MATTER_STAGE_GROUPS],
        description: `Optional stage group: ${STAGE_GROUP_LIST}.`,
      },
      sort: {
        type: 'string',
        enum: [...MATTER_SORT_KEYS],
        description: 'Row order. Defaults to client_asc (alphabetical by client).',
      },
      include_closed: {
        type: 'boolean',
        description:
          'Include closed and archived matters. Defaults to false — the list is open work. ' +
          'Set it when the attorney asks about closed, finished or archived matters.',
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

export function matterExportSystemPromptNote() {
  return `\n\nMATTER EXPORT: Call \`${EXPORT_MATTERS_TOOL_NAME}\` when the attorney asks for a list, export, or spreadsheet of matters or active clients. It returns each matter's client, email, phone, matter number, matter name, practice area, stage, intake status, fee and last milestone date, plus a CSV download link. It covers open matters by default — closed and archived ones are left out unless you pass \`include_closed: true\`, which is what to do when the attorney asks about closed or finished work. Present the rows as a compact markdown table with only the columns the attorney asked about, and mention the download link. Leave a blank field blank rather than inventing one. If the result reports \`truncated: true\`, say how many matters matched in total and that the CSV holds the full set.`
}

export const exportMattersToolExecutor: AdminChatToolExecutor = {
  tool: EXPORT_MATTERS_TOOL,
  execute: async (input, { toolUseId, emit }) => {
    const fields = (input ?? {}) as Record<string, unknown>
    const filters = matterTableFiltersFrom({
      search: fields.search,
      practice: fields.practice_area,
      stage: fields.stage_group,
      closed: fields.include_closed,
    })
    const sort = matterSortKeyFrom(fields.sort)
    const limit = Math.min(
      INLINE_ROW_LIMIT,
      fields.limit === undefined ? INLINE_ROW_LIMIT : clampMatterExportLimit(fields.limit),
    )

    try {
      const page = await fetchMatterExportRows(filters, { sort, limit })
      const downloadUrl = matterExportUrl(filters, sort)
      const filename = matterExportFilename(matterExportLabel(filters))

      emit({
        tool: EXPORT_MATTERS_TOOL_NAME,
        tool_use_id: toolUseId,
        status: 'done',
        result: { row_count: page.total, filename, download_url: downloadUrl },
      })

      return {
        content: JSON.stringify({
          ok: true,
          filters: {
            search: filters.search || null,
            practice_area: filters.practice,
            stage_group: filters.stageGroup,
            include_closed: filters.includeClosed,
            sort,
          },
          returned: page.rows.length,
          total_matching: page.total,
          truncated: page.truncated,
          download_url: downloadUrl,
          matters: page.rows,
        }),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Matter export failed'
      emit({ tool: EXPORT_MATTERS_TOOL_NAME, tool_use_id: toolUseId, status: 'error', error: message })
      return { content: JSON.stringify({ ok: false, error: message }), isError: true }
    }
  },
}
