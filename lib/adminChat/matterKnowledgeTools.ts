import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { quoteUserContent } from '@/lib/anthropic'
import {
  DOCUMENT_TEXT_LIMIT,
  MATTER_SECTIONS,
  MATTER_SECTION_DESCRIPTIONS,
  isMatterSection,
  loadMatterDossier,
  readMatterDocumentText,
  resolveRecordMatterId,
  searchMatterRecords,
  type MatterSection,
} from '@/lib/matterKnowledge'

export const FIND_MATTER_TOOL_NAME = 'find_matter'
export const READ_MATTER_RECORD_TOOL_NAME = 'read_matter_record'
export const READ_DOCUMENT_TEXT_TOOL_NAME = 'read_document_text'

const SECTION_LIST = MATTER_SECTIONS.map(
  section => `- ${section}: ${MATTER_SECTION_DESCRIPTIONS[section]}`,
).join('\n')

const FIND_MATTER_TOOL: Anthropic.Tool = {
  name: FIND_MATTER_TOOL_NAME,
  description:
    'Find matters and leads by client name, matter name, or client email. ' +
    'Use this first whenever the attorney names a client the current chat is not already opened on, ' +
    'then pass the returned id to ' + READ_MATTER_RECORD_TOOL_NAME + '. Read-only.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Client name, matter name, or email to search for. Partial matches are fine.',
      },
      limit: { type: 'number', description: 'Maximum records to return. Defaults to 10.' },
    },
    required: ['query'],
  },
}

const READ_MATTER_RECORD_TOOL: Anthropic.Tool = {
  name: READ_MATTER_RECORD_TOOL_NAME,
  description:
    'Read the firm\'s record for a matter or lead — the live data behind the matter page. ' +
    'Request only the sections needed to answer; each is independent.\n\n' +
    SECTION_LIST +
    '\n\nRead-only: this never changes anything. Intake answers, the design sheet, assets and ' +
    'fiduciary decisions are already in the conversation context for the matter the chat is ' +
    'opened on, so do not use this tool to re-read those for that matter.',
  input_schema: {
    type: 'object',
    properties: {
      matter_id: {
        type: 'string',
        description:
          'The matter or lead id. Omit to read the matter this chat is opened on. ' +
          'Use ' + FIND_MATTER_TOOL_NAME + ' to resolve a name to an id.',
      },
      sections: {
        type: 'array',
        description: 'Which sections to read. Defaults to overview.',
        items: { type: 'string', enum: [...MATTER_SECTIONS] },
      },
      limit: {
        type: 'number',
        description: 'Maximum rows per section (1-200). Defaults to 40.',
      },
    },
    required: ['sections'],
  },
}

const READ_DOCUMENT_TEXT_TOOL: Anthropic.Tool = {
  name: READ_DOCUMENT_TEXT_TOOL_NAME,
  description:
    'Read the text of a document filed to a matter, so it can be summarized, compared or quoted. ' +
    'Word (.docx) and PDF files are extracted; get the document_id from the `documents` section of ' +
    READ_MATTER_RECORD_TOOL_NAME + '. Long documents are truncated — say so if the result reports ' +
    'truncated: true rather than implying you read the whole thing. Read-only.',
  input_schema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'The document id to read.' },
      max_characters: {
        type: 'number',
        description: `Maximum characters to return (500-${DOCUMENT_TEXT_LIMIT}). Defaults to the maximum.`,
      },
    },
    required: ['document_id'],
  },
}

export function matterKnowledgeSystemPromptNote() {
  return `\n\nFIRM RECORD ACCESS: Everything the app holds about a matter is available to you through tools, not only what is quoted above. Call \`${READ_MATTER_RECORD_TOOL_NAME}\` for its documents, people, notes, tasks, billing, communications, appointments, activity feed or engagement status, requesting only the sections you need. Call \`${FIND_MATTER_TOOL_NAME}\` first when the attorney names a client this chat is not opened on. Call \`${READ_DOCUMENT_TEXT_TOOL_NAME}\` to read a filed document's actual text before summarizing or quoting it. Prefer reading over guessing: if a question can be answered from the record, pull it rather than saying you do not have access. State plainly when a section comes back empty — an empty section means the firm has nothing filed, not that you could not look.`
}

function toSections(value: unknown): MatterSection[] {
  if (!Array.isArray(value)) return []
  return value.filter(isMatterSection)
}

/**
 * The read-only firm-record tools.
 *
 * `defaultRecordId` is the matter or lead the chat is opened on; a tool call
 * that omits `matter_id` means "this one". The general assistant passes null,
 * and there the id is required — which is what `find_matter` is for.
 */
export function matterKnowledgeToolExecutors(
  options: { defaultRecordId?: string | null } = {},
): AdminChatToolExecutor[] {
  const defaultMatterId = options.defaultRecordId ?? null

  const findMatter: AdminChatToolExecutor = {
    tool: FIND_MATTER_TOOL,
    execute: async (input, { toolUseId, emit }) => {
      const fields = (input ?? {}) as { query?: unknown; limit?: unknown }
      const query = typeof fields.query === 'string' ? fields.query : ''
      if (!query.trim()) {
        return { content: JSON.stringify({ ok: false, error: 'query is required' }), isError: true }
      }
      try {
        const results = await searchMatterRecords(
          query,
          typeof fields.limit === 'number' ? fields.limit : 10,
        )
        emit({
          tool: FIND_MATTER_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'done',
          result: { query, match_count: results.length },
        })
        return { content: JSON.stringify({ ok: true, matches: results }) }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Search failed'
        emit({ tool: FIND_MATTER_TOOL_NAME, tool_use_id: toolUseId, status: 'error', error: message })
        return { content: JSON.stringify({ ok: false, error: message }), isError: true }
      }
    },
  }

  const readRecord: AdminChatToolExecutor = {
    tool: READ_MATTER_RECORD_TOOL,
    execute: async (input, { toolUseId, emit }) => {
      const fields = (input ?? {}) as { matter_id?: unknown; sections?: unknown; limit?: unknown }
      const requestedId = typeof fields.matter_id === 'string' && fields.matter_id.trim()
        ? fields.matter_id.trim()
        : defaultMatterId
      if (!requestedId) {
        return {
          content: JSON.stringify({
            ok: false,
            error: `No matter in context. Call ${FIND_MATTER_TOOL_NAME} first and pass matter_id.`,
          }),
          isError: true,
        }
      }

      const sections = toSections(fields.sections)
      if (sections.length === 0) {
        return {
          content: JSON.stringify({
            ok: false,
            error: `sections must name at least one of: ${MATTER_SECTIONS.join(', ')}`,
          }),
          isError: true,
        }
      }

      try {
        // A lead chat's context id is its client_intake row, not its matter.
        const matterId = await resolveRecordMatterId(requestedId)
        if (!matterId) {
          return {
            content: JSON.stringify({ ok: false, error: `No matter or lead found for id ${requestedId}` }),
            isError: true,
          }
        }
        const dossier = await loadMatterDossier(matterId, sections, {
          limit: typeof fields.limit === 'number' ? fields.limit : undefined,
        })
        emit({
          tool: READ_MATTER_RECORD_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'done',
          result: {
            matter_id: matterId,
            matter_label: dossier.matter_label,
            sections,
          },
        })
        return { content: JSON.stringify({ ok: true, ...dossier }) }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read the matter record'
        emit({
          tool: READ_MATTER_RECORD_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'error',
          error: message,
        })
        return { content: JSON.stringify({ ok: false, error: message }), isError: true }
      }
    },
  }

  const readDocument: AdminChatToolExecutor = {
    tool: READ_DOCUMENT_TEXT_TOOL,
    execute: async (input, { toolUseId, emit }) => {
      const fields = (input ?? {}) as { document_id?: unknown; max_characters?: unknown }
      const documentId = typeof fields.document_id === 'string' ? fields.document_id.trim() : ''
      if (!documentId) {
        return { content: JSON.stringify({ ok: false, error: 'document_id is required' }), isError: true }
      }
      try {
        const result = await readMatterDocumentText(documentId, {
          maxCharacters: typeof fields.max_characters === 'number' ? fields.max_characters : undefined,
        })
        emit({
          tool: READ_DOCUMENT_TEXT_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'done',
          result: {
            document_id: result.document_id,
            name: result.name,
            characters: result.characters,
            truncated: result.truncated,
          },
        })
        // A stored document is whatever a client uploaded or typed. Hand its
        // body to the model as fenced data so instructions inside it read as
        // content — the same treatment the Word add-in gives an open document.
        return {
          content: JSON.stringify({
            ok: true,
            ...result,
            text: quoteUserContent('matter-document', result.text),
          }),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read the document'
        emit({
          tool: READ_DOCUMENT_TEXT_TOOL_NAME,
          tool_use_id: toolUseId,
          status: 'error',
          error: message,
        })
        return { content: JSON.stringify({ ok: false, error: message }), isError: true }
      }
    },
  }

  return [findMatter, readRecord, readDocument]
}
