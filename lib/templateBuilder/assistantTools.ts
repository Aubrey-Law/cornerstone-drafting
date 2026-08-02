import fs from 'node:fs'
import path from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { renderNodeEstateDocxTemplate } from '@/lib/estateGenerator/node/templateRenderer'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'
import { extractTemplateVariables, knownClauseIds, knownTemplateRoots } from '@/lib/estateGenerator/templateVariables'
import { createCustomTemplate, customTemplateId } from '@/lib/documentTemplates/customTemplates'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { createDocumentTemplateVersion } from '@/lib/documentTemplates/repository'
import {
  getTemplateBuilderUpload,
  loadTemplateBuilderBuffer,
  saveTemplateBuilderRevision,
} from '@/lib/templateBuilder/uploads'
import { applyDocxReplacements, extractDocxParagraphText } from '@/lib/templateBuilder/docxEdit'

const MAX_TEXT_CHARS = 16000
const MAX_FIELD_RESULTS = 80

interface DictionaryEntry {
  type?: string
  description?: string
  required?: boolean | string
}

function loadDictionary(): Record<string, DictionaryEntry> {
  try {
    const root = resolveNodeEstateGeneratorRoot()
    return JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'data-dictionary.json'), 'utf8')) as Record<string, DictionaryEntry>
  } catch {
    return {}
  }
}

function normalizeToDictionaryPath(variablePath: string): string {
  return variablePath.replace(/\.\d+(?=\.|$)/g, '[]').replace(/\[\d+\]/g, '[]')
}

async function requireUpload(input: unknown): Promise<{ uploadId: string }> {
  const { upload_id: uploadId } = (input ?? {}) as { upload_id?: unknown }
  if (typeof uploadId !== 'string' || !uploadId.trim()) {
    throw new Error('upload_id is required')
  }
  return { uploadId: uploadId.trim() }
}

function toolError(message: string): { content: string; isError: true } {
  return { content: JSON.stringify({ ok: false, error: message }), isError: true }
}

function classifyVariables(variables: string[]): { known: string[]; unknown: string[] } {
  const dictionary = loadDictionary()
  const roots = knownTemplateRoots()
  const known: string[] = []
  const unknown: string[] = []
  for (const variable of variables) {
    const root = variable.split(/[.[]/)[0]
    if (roots.has(root) || normalizeToDictionaryPath(variable) in dictionary) known.push(variable)
    else unknown.push(variable)
  }
  return { known, unknown }
}

function loadExampleData(): NodeEstateData {
  const root = resolveNodeEstateGeneratorRoot()
  const examplesDir = path.join(root, 'examples')
  const preferred = ['client-ma-joint-trust.json', 'client-ma-incapacity.json']
  const available = fs.existsSync(examplesDir)
    ? fs.readdirSync(examplesDir).filter(name => name.endsWith('.json')).sort()
    : []
  // Merge a preferred example over the union of every example's top-level
  // blocks so most roots have sample values.
  const merged: Record<string, unknown> = {}
  for (const fileName of available) {
    try {
      const example = JSON.parse(fs.readFileSync(path.join(examplesDir, fileName), 'utf8')) as Record<string, unknown>
      for (const [key, value] of Object.entries(example)) {
        if (!(key in merged)) merged[key] = value
      }
    } catch { /* skip malformed */ }
  }
  for (const fileName of preferred) {
    try {
      Object.assign(merged, JSON.parse(fs.readFileSync(path.join(examplesDir, fileName), 'utf8')) as Record<string, unknown>)
    } catch { /* optional */ }
  }
  return merged as NodeEstateData
}

const ANALYZE_TOOL: Anthropic.Tool = {
  name: 'analyze_template_upload',
  description:
    'Read a DOCX uploaded to the Template Builder. Returns its reading text, any existing {{ }} merge fields and ' +
    'include_clause ids, and which referenced variables are unknown to the generator. Call this first whenever a ' +
    'message contains a [Template upload: <id>] tag.',
  input_schema: {
    type: 'object',
    properties: {
      upload_id: { type: 'string', description: 'The id from the [Template upload: <id>] tag.' },
    },
    required: ['upload_id'],
  },
}

const LIST_FIELDS_TOOL: Anthropic.Tool = {
  name: 'list_template_fields',
  description:
    'Search the canonical merge-field dictionary (client, spouse, children, trust, will, fiduciaries, healthcare, ' +
    'execution, …) used in document templates. Use this to map document text to the correct {{ path }}. Anything ' +
    'without a canonical field can use the extras.* namespace (attorney fills the value per matter).',
  input_schema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Optional substring filter over path and description.' },
    },
  },
}

const APPLY_EDITS_TOOL: Anthropic.Tool = {
  name: 'apply_template_edits',
  description:
    'Rewrite literal text inside the uploaded DOCX — e.g. replace "[CLIENT NAME]" or "John Doe" with ' +
    '"{{ client.full_name | name }}". Applies exact-text replacements (formatting is preserved; when Word split the ' +
    'text across runs the paragraph keeps its first run\'s formatting). Saves a new revision; the original upload is ' +
    'never overwritten. Only call this after the attorney has confirmed the proposed mappings.',
  input_schema: {
    type: 'object',
    properties: {
      upload_id: { type: 'string' },
      replacements: {
        type: 'array',
        description: 'Ordered exact-text replacements.',
        items: {
          type: 'object',
          properties: {
            find: { type: 'string', description: 'Exact text currently in the document.' },
            replace: { type: 'string', description: 'Replacement text, e.g. {{ client.full_name | name }}.' },
          },
          required: ['find', 'replace'],
        },
      },
    },
    required: ['upload_id', 'replacements'],
  },
}

const PREVIEW_TOOL: Anthropic.Tool = {
  name: 'preview_template_render',
  description:
    'Render the current working copy through the real document generator to verify it. Uses bundled sample data by ' +
    'default, or a real matter when matter_id is given. Returns missing fields ([[ MISSING ]] holes) and unresolved ' +
    'template markers. Always preview after apply_template_edits and before registering.',
  input_schema: {
    type: 'object',
    properties: {
      upload_id: { type: 'string' },
      matter_id: { type: 'string', description: 'Optional matter UUID to render against real data.' },
    },
    required: ['upload_id'],
  },
}

const REGISTER_CUSTOM_TOOL: Anthropic.Tool = {
  name: 'register_custom_template',
  description:
    'Register the current working copy as a custom template, immediately usable in Quick Draft for every matter. ' +
    'Only call after the attorney explicitly confirms the template is ready.',
  input_schema: {
    type: 'object',
    properties: {
      upload_id: { type: 'string' },
      label: { type: 'string', description: 'Display name shown in the Quick Draft picker.' },
      output_filename: { type: 'string', description: 'Optional generated-document filename (must end in .docx).' },
    },
    required: ['upload_id', 'label'],
  },
}

const LIST_MASTERS_TOOL: Anthropic.Tool = {
  name: 'list_master_templates',
  description:
    'List the firm\'s registered document masters (bundled templates that can receive staged version uploads), with ' +
    'their template ids. Use when the attorney wants to update an existing master rather than create a custom template.',
  input_schema: { type: 'object', properties: {} },
}

const STAGE_MASTER_TOOL: Anthropic.Tool = {
  name: 'stage_master_template_version',
  description:
    'Stage the current working copy as a NEW VERSION of an existing document master. The version is staged only — ' +
    'the attorney validates and publishes it manually from the Library (publishing cannot be done by this tool). ' +
    'Only call after the attorney explicitly confirms.',
  input_schema: {
    type: 'object',
    properties: {
      upload_id: { type: 'string' },
      template_id: { type: 'string', description: 'Master template id from list_master_templates, e.g. estate-pourover-will.' },
    },
    required: ['upload_id', 'template_id'],
  },
}

export function templateBuilderSystemPromptNote() {
  return '\n\nTEMPLATE BUILDER: When a user message contains a `[Template upload: <id>]` tag, an attorney has uploaded a DOCX to turn into a document template. Immediately call `analyze_template_upload` with that id, then follow the Template Builder workflow (read it via `read_workflow` if attached). Never register or stage a template without the attorney\'s explicit confirmation in this conversation.'
}

export function templateBuilderToolExecutors(userId: string): AdminChatToolExecutor[] {
  return [
    {
      tool: ANALYZE_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        try {
          const { uploadId } = await requireUpload(input)
          const row = await getTemplateBuilderUpload(uploadId)
          if (!row) return toolError(`No template upload found with id ${uploadId}`)
          const buffer = await loadTemplateBuilderBuffer(row)
          const report = extractTemplateVariables(buffer)
          const { known, unknown } = classifyVariables(report.variables)
          const clauseIds = knownClauseIds()
          const text = extractDocxParagraphText(buffer)
          emit({ tool: ANALYZE_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { filename: row.filename, revision: row.revision } })
          return {
            content: JSON.stringify({
              ok: true,
              upload: { id: row.id, filename: row.filename, revision: row.revision, byte_size: row.byte_size },
              existingMergeFields: { known, unknown },
              clauses: report.clauses.map(id => ({ id, exists: clauseIds.has(id) })),
              localVariables: report.localVariables,
              text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…[truncated ${text.length - MAX_TEXT_CHARS} chars]` : text,
            }),
          }
        } catch (error) {
          return toolError(error instanceof Error ? error.message : 'Analyze failed')
        }
      },
    },
    {
      tool: LIST_FIELDS_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        const { search } = (input ?? {}) as { search?: unknown }
        const needle = typeof search === 'string' ? search.trim().toLowerCase() : ''
        const dictionary = loadDictionary()
        const entries = Object.entries(dictionary)
          .filter(([fieldPath, entry]) => !needle
            || fieldPath.toLowerCase().includes(needle)
            || (entry.description ?? '').toLowerCase().includes(needle))
          .slice(0, MAX_FIELD_RESULTS)
          .map(([fieldPath, entry]) => ({ path: fieldPath, type: entry.type ?? 'string', description: entry.description ?? null }))
        emit({ tool: LIST_FIELDS_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { count: entries.length } })
        return {
          content: JSON.stringify({
            ok: true,
            fields: entries,
            notes: 'Name filters: `| name` renders a person name, `| NAME` uppercase. Values with no canonical field can use extras.<snake_case_name> (attorney supplies the value per matter). Computed flags like has_spouse / has_minor_children are available for {% if %} conditions.',
          }),
        }
      },
    },
    {
      tool: APPLY_EDITS_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        try {
          const { uploadId } = await requireUpload(input)
          const { replacements } = (input ?? {}) as { replacements?: unknown }
          if (!Array.isArray(replacements) || replacements.length === 0) {
            return toolError('replacements must be a non-empty array of { find, replace }')
          }
          const cleaned = replacements
            .filter((item): item is { find: string; replace: string } =>
              Boolean(item) && typeof (item as { find?: unknown }).find === 'string' && typeof (item as { replace?: unknown }).replace === 'string')
          if (cleaned.length === 0) return toolError('No valid replacements provided')

          const row = await getTemplateBuilderUpload(uploadId)
          if (!row) return toolError(`No template upload found with id ${uploadId}`)
          const buffer = await loadTemplateBuilderBuffer(row)
          const edit = applyDocxReplacements(buffer, cleaned)

          // The revised file must still be a parseable template.
          const report = extractTemplateVariables(edit.buffer)
          const { unknown } = classifyVariables(report.variables)

          const saved = edit.applied > 0 ? await saveTemplateBuilderRevision(row, edit.buffer) : row
          emit({ tool: APPLY_EDITS_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { applied: edit.applied, notFound: edit.notFound, revision: saved.revision } })
          return {
            content: JSON.stringify({
              ok: true,
              revision: saved.revision,
              results: edit.results,
              applied: edit.applied,
              notFound: edit.notFound,
              unknownVariablesAfterEdit: unknown,
              note: edit.notFound > 0
                ? 'Some find-texts were not found — re-check exact wording via analyze_template_upload and retry those.'
                : undefined,
            }),
          }
        } catch (error) {
          return toolError(error instanceof Error ? error.message : 'Edit failed')
        }
      },
    },
    {
      tool: PREVIEW_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        try {
          const { uploadId } = await requireUpload(input)
          const { matter_id: matterId } = (input ?? {}) as { matter_id?: unknown }
          const row = await getTemplateBuilderUpload(uploadId)
          if (!row) return toolError(`No template upload found with id ${uploadId}`)
          const templateBuffer = await loadTemplateBuilderBuffer(row)

          const root = resolveNodeEstateGeneratorRoot()
          let data: NodeEstateData
          let state = 'MA'
          let source: string
          if (typeof matterId === 'string' && matterId.trim()) {
            const payload = await buildDraftPayload(matterId.trim(), { allowPartial: true })
            data = toEstateGeneratorData(payload) as unknown as NodeEstateData
            state = normalizeJurisdictionStateCode(payload.client.state)
            source = `matter ${matterId.trim()}`
          } else {
            data = loadExampleData()
            source = 'bundled sample data'
          }
          const context = buildNodeEstateContext({ data, state, root })
          const clauses = createNodeClauseStore({ root, state, allowDraft: true })
          const rendered = renderNodeEstateDocxTemplate({ templateBuffer, context, clauses })
          emit({ tool: PREVIEW_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { missing: rendered.missingFields.length, unresolved: rendered.unresolvedMarkers.length } })
          return {
            content: JSON.stringify({
              ok: true,
              source,
              missingFields: rendered.missingFields,
              unresolvedMarkers: rendered.unresolvedMarkers,
              warnings: clauses.report.warnings,
            }),
          }
        } catch (error) {
          return toolError(error instanceof Error ? error.message : 'Preview failed')
        }
      },
    },
    {
      tool: REGISTER_CUSTOM_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        try {
          const { uploadId } = await requireUpload(input)
          const { label, output_filename: outputFilename } = (input ?? {}) as { label?: unknown; output_filename?: unknown }
          if (typeof label !== 'string' || !label.trim()) return toolError('label is required')
          const row = await getTemplateBuilderUpload(uploadId)
          if (!row) return toolError(`No template upload found with id ${uploadId}`)
          const buffer = await loadTemplateBuilderBuffer(row)
          const created = await createCustomTemplate({
            label: label.trim(),
            buffer,
            actorId: userId,
            outputFilename: typeof outputFilename === 'string' ? outputFilename : undefined,
          })
          emit({ tool: REGISTER_CUSTOM_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { label: created.label } })
          return {
            content: JSON.stringify({
              ok: true,
              templateId: customTemplateId(created.id),
              label: created.label,
              outputFilename: created.output_filename,
              note: 'The template is now available in Quick Draft (matter → drafting → Quick Draft) for every matter.',
            }),
          }
        } catch (error) {
          return toolError(error instanceof Error ? error.message : 'Registration failed')
        }
      },
    },
    {
      tool: LIST_MASTERS_TOOL,
      execute: async (_input, { toolUseId, emit }) => {
        const templates = getDocumentTemplateRegistry().map(definition => ({
          id: definition.id,
          label: definition.label,
          category: definition.category,
          packageNames: definition.packageNames,
        }))
        emit({ tool: LIST_MASTERS_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { count: templates.length } })
        return { content: JSON.stringify({ ok: true, templates }) }
      },
    },
    {
      tool: STAGE_MASTER_TOOL,
      execute: async (input, { toolUseId, emit }) => {
        try {
          const { uploadId } = await requireUpload(input)
          const { template_id: templateId } = (input ?? {}) as { template_id?: unknown }
          if (typeof templateId !== 'string' || !templateId.trim()) return toolError('template_id is required')
          const definition = getDocumentTemplateRegistry().find(candidate => candidate.id === templateId.trim())
          if (!definition) return toolError(`Unknown master template id: ${templateId}`)
          const row = await getTemplateBuilderUpload(uploadId)
          if (!row) return toolError(`No template upload found with id ${uploadId}`)
          const buffer = await loadTemplateBuilderBuffer(row)
          const version = await createDocumentTemplateVersion({
            templateId: definition.id,
            filename: row.filename,
            buffer,
            actorId: userId,
          })
          emit({ tool: STAGE_MASTER_TOOL.name, tool_use_id: toolUseId, status: 'done', result: { templateId: definition.id } })
          return {
            content: JSON.stringify({
              ok: true,
              templateId: definition.id,
              versionId: (version as { id?: string }).id ?? null,
              note: 'Version staged only. The attorney must validate it against a matter and publish it from the Library → Document masters — publishing is intentionally manual.',
            }),
          }
        } catch (error) {
          return toolError(error instanceof Error ? error.message : 'Staging failed')
        }
      },
    },
  ]
}
