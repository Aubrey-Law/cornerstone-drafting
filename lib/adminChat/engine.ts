import Anthropic from '@anthropic-ai/sdk'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient, PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'
import { getFirmConfig } from '@/lib/firmConfig'
import {
  type Row,
  text,
  fullName,
  summarizeAssets,
  summarizeFamily,
  summarizeFiduciaries,
  formatIntakeQuestionnaire,
  formatDesignSheetSummary,
  draftPayloadFactSheet,
  draftingSkillSummaryInstructions,
  trustDraftingIntakeInstructions,
  incapacityDesignSheetInstructions,
} from '@/lib/adminChat/prompts'

export type ChatContextType = 'matter' | 'lead' | 'general'

export interface MatterContext {
  systemPrompt: string
  matterLabel: string | null
}

export const DESIGN_SHEET_IMPORT_TOOL_NAME = 'propose_design_sheet_updates'
export const DESIGN_SHEET_STATUS_TOOL_NAME = 'read_design_sheet_status'

const CHAT_MATTER_COLUMNS =
  'id, client_intake_id, matter_number, stage, status, name' as const
const CHAT_PIPELINE_COLUMNS =
  'matter_id, practice_area, marital_status, client_dob, stage, status, matter_name, plan_type, has_minor_children' as const
// Select all columns: the chat reads many intake fields and a hand-maintained
// list drifts from the schema (e.g. `referral_source` does not exist on
// client_intake), which throws and drops the whole matter context. `select('*')`
// matches fetchIntakeForMatter and is resilient to schema drift.
const CHAT_INTAKE_COLUMNS = '*' as const
const CHAT_MATTER_NOTE_COLUMNS =
  'created_at, note_type, body' as const
const CHAT_MATTER_DETAILS_COLUMNS =
  'practice_area, legal_plan, legal_plan_id, legal_plan_type, legal_plan_service_start, legal_plan_service_end, ep_plan_category, plan_type' as const
// `decisions` and the will-provision columns are here so the assistant can see
// the provisions at all. Without them it saw ~20 of ~200 fields — every trust,
// DPOA and health-care decision was invisible, so it could neither report what
// was missing nor avoid re-asking what was already settled.
const CHAT_DESIGN_SHEET_COLUMNS =
  'status, plan_type, trust_name, is_joint, client_name, spouse_name, marital_status, county, children, assets, goals_notes, concerns, excluded_guardian_flag, excluded_guardian_name, trustee_slots, executor_slots, poa_slots, hcp_slots, guardian_slots, spouse_trustee_slots, spouse_executor_slots, spouse_poa_slots, spouse_hcp_slots, decisions, bond, supervision, utma_age, no_contest_clause, pr_structure, trustee_structure, beneficiary_structure, age_distribution_schedule, simultaneous_death, distribution_age, restatement, trust_protector' as const

export async function generalSystemPrompt() {
  const firm = getFirmConfig()
  return `You are an AI legal assistant for ${firm.attorneyShortName}, a Massachusetts estate planning attorney at ${firm.firmName}.

You specialize in:
- Massachusetts estate planning law (wills, trusts, powers of attorney, healthcare proxies)
- Massachusetts probate procedure
- MA estate tax (threshold: $2M, top rate 16%, QTIP elections, credit shelter trusts)
- Practice management for a solo estate planning practice

You can also answer questions about the attorney's pipeline, matter stages, and client management. When the attorney asks about a specific client or matter, look it up: call find_matter with the name, then read_matter_record for the sections the question needs. Do not tell the attorney to open the matter page instead — the record is available to you here.

Be concise. Use plain language unless the attorney asks for technical detail.

${PROMPT_INJECTION_GUARDRAIL}${await trustDraftingIntakeInstructions()}${await incapacityDesignSheetInstructions()}`
}

export async function loadMatterContext(contextId: string): Promise<MatterContext> {
  const admin = getAdminClient()
  const matterRes = await admin
    .from('matters')
    .select(CHAT_MATTER_COLUMNS)
    .eq('id', contextId)
    .maybeSingle()

  if (matterRes.error) throw new Error(`matters: ${matterRes.error.message}`)
  const matter = matterRes.data as Row | null
  if (!matter) throw new Error('Matter not found')

  const intakeId = matter.client_intake_id
  const [pipelineRes, intakeRes, notesRes, detailsRes, designSheetRes, assetIntakeRes] = await Promise.all([
    admin.from('v_matter_pipeline').select(CHAT_PIPELINE_COLUMNS).eq('matter_id', contextId).maybeSingle(),
    intakeId
      ? admin.from('client_intake').select(CHAT_INTAKE_COLUMNS).eq('id', String(intakeId)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('matter_notes')
      .select(CHAT_MATTER_NOTE_COLUMNS)
      .eq('matter_id', contextId)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('matter_details').select(CHAT_MATTER_DETAILS_COLUMNS).eq('client_id', contextId).maybeSingle(),
    admin
      .from('design_sheets')
      .select(CHAT_DESIGN_SHEET_COLUMNS)
      .eq('matter_id', contextId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    intakeId
      ? admin
          .from('asset_intake')
          .select('category, description, value, ownership')
          .eq('client_intake_id', String(intakeId))
          .order('category')
      : Promise.resolve({ data: [], error: null }),
  ])

  const labeledResults = [
    ['v_matter_pipeline', pipelineRes],
    ['client_intake', intakeRes],
    ['matter_notes', notesRes],
    ['matter_details', detailsRes],
    ['design_sheets', designSheetRes],
    ['asset_intake', assetIntakeRes],
  ] as const
  for (const [label, res] of labeledResults) {
    if (res.error) {
      console.warn(`[admin chat] matter context: ${label} query failed`, {
        matterId: contextId,
        error: res.error.message,
      })
    }
  }

  const pipeline = pipelineRes.data as Row | null
  const rawIntake = intakeRes.data as Row | null
  // Keyed by matter since step 3 of docs/matter-contacts-migration.md, and
  // contextId is already the matter here.
  const spouseContact = await loadSpouseContact(admin, contextId)
  const childContacts = await loadHouseholdChildren(admin, contextId)
  const intake: Row | null = rawIntake
    ? ({
        ...rawIntake,
        spouse_first_name: spouseContact?.first_name ?? null,
        spouse_last_name: spouseContact?.last_name ?? null,
        spouse_name: spouseContact
          ? [spouseContact.first_name, spouseContact.last_name].filter(Boolean).join(' ') || null
          : null,
        spouse_email: spouseContact?.email ?? null,
        spouse_phone: spouseContact?.phone ?? null,
        spouse_date_of_birth: spouseContact?.date_of_birth ?? null,
        // Children sourced from contacts (overlay), like spouse.
        children: childContacts,
      } as Row)
    : rawIntake
  const details = detailsRes.data as Row | null
  const designSheet = designSheetRes.data as Row | null
  const notes = (notesRes.data ?? []) as Row[]
  const assetIntakeRows = (assetIntakeRes.data ?? []) as Row[]

  const noteLines = notes.slice(0, 5).map(note => {
    const date = text(note.created_at)
    const kind = text(note.note_type, 'note')
    const body = text(note.body)
    return `- ${date} [${kind}] ${body}`
  }).join('\n') || '-'

  const firm = getFirmConfig()
  const practiceArea = (details?.practice_area ?? pipeline?.practice_area ?? '') as string
  const legalPlan = (details?.legal_plan ?? '') as string

  const designSheetImportNote = `\n\nDESIGN SHEET IMPORT TOOL: If the attorney asks to import, map, fill, update, or extract design-sheet fields from pasted or typed design-sheet text, call the \`${DESIGN_SHEET_IMPORT_TOOL_NAME}\` tool with the raw text they provided. The tool only proposes updates for attorney review; it never saves design-sheet data. Do not claim anything was saved unless the attorney uses the review flow.

DESIGN SHEET STATUS TOOL: Call \`${DESIGN_SHEET_STATUS_TOOL_NAME}\` whenever the attorney asks what a design sheet still needs, what is blocking drafting, or before running any design-sheet interview. It returns the required and optional items that are still open. Ask only about what it reports as open — the provisions already decided are listed in the design sheet context above, and re-asking them wastes the attorney's time.`
  const draftingSummaryNote = await draftingSkillSummaryInstructions()
  const trustIntakeNote = await trustDraftingIntakeInstructions()
  const incapacityIntakeNote = await incapacityDesignSheetInstructions()

  // Normalized design-sheet facts (resolved fiduciary names, trust/will/DPOA/HCP
  // provisions, documents). This is the richest view of the design sheet and is
  // what the trust + incapacity intake prompts pre-fill from. Guarded so an
  // incomplete design sheet never breaks the chat — we fall back to the summary
  // fields above.
  let designSheetSection = ''
  try {
    const draftPayload = await buildDraftPayload(contextId)
    designSheetSection = `\n\nDESIGN SHEET (normalized from the attorney-entered design sheet — treat these resolved values as the source of truth for trust and incapacity drafting; pre-fill from them and only ask Scott for items shown as [UNKNOWN]):\n\n${draftPayloadFactSheet(draftPayload)}`
  } catch (error) {
    console.warn('[admin chat] design sheet payload unavailable for context', {
      matterId: contextId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const systemPrompt = `You are an AI legal assistant for ${firm.attorneyShortName}, a Massachusetts estate planning attorney at ${firm.firmName}.

You have full context for this matter:

CLIENT: ${fullName(intake)}, ${text(intake?.marital_status ?? pipeline?.marital_status)}, DOB ${text(intake?.date_of_birth ?? pipeline?.client_dob)}
MATTER: ${text(matter.matter_number)} - ${text(practiceArea)} - Stage: ${text(matter.stage ?? pipeline?.stage)} - Status: ${text(matter.status ?? pipeline?.status)}
MATTER NAME: ${text(matter.name ?? pipeline?.matter_name)}
PLAN TYPE: ${text(details?.ep_plan_category ?? details?.plan_type ?? intake?.plan_type ?? pipeline?.plan_type)}
LEGAL PLAN: ${text(legalPlan || '-')} ${details?.legal_plan_id ? `(Member ID ${text(details.legal_plan_id)})` : ''}
${quoteUserContent('client-intake-questionnaire', formatIntakeQuestionnaire(intake, pipeline))}
${formatDesignSheetSummary(designSheet)}
ASSETS:
${quoteUserContent('client-reported-assets', summarizeAssets(intake, designSheet, assetIntakeRows))}
FAMILY:
${summarizeFamily(intake, pipeline)}
FIDUCIARIES:
${summarizeFiduciaries(intake, designSheet)}
SPECIAL CONCERNS:
${quoteUserContent('client-concerns', text(designSheet?.concerns ?? intake?.concerns ?? intake?.special_notes ?? intake?.planning_objectives))}
RECENT NOTES:
${quoteUserContent('matter-notes', noteLines)}${designSheetSection}

Respond in plain, concise attorney-facing language. You may draft text (emails, summaries, clauses) when asked. Always flag if you're uncertain. Do not invent facts not present in the context above.

${PROMPT_INJECTION_GUARDRAIL}${designSheetImportNote}${draftingSummaryNote}${trustIntakeNote}${incapacityIntakeNote}`

  const matterLabel = [
    text(matter.name ?? pipeline?.matter_name, ''),
    matter.matter_number ? `#${text(matter.matter_number, '')}` : '',
  ].filter(Boolean).join(' · ') || null

  return {
    systemPrompt,
    matterLabel,
  }
}

export async function loadLeadContext(contextId: string): Promise<MatterContext> {
  const admin = getAdminClient()
  const [leadRes, notesRes, meetingsRes, activityRes, assetsRes] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', contextId).maybeSingle(),
    admin.from('lead_notes').select('created_at, body').eq('lead_id', contextId).order('created_at', { ascending: false }).limit(10),
    admin.from('lead_meeting_notes').select('meeting_date, title, body').eq('lead_id', contextId).order('meeting_date', { ascending: false }).limit(5),
    admin.from('lead_activity').select('created_at, title, detail').eq('lead_id', contextId).order('created_at', { ascending: false }).limit(10),
    admin.from('asset_intake').select('category, description, value, ownership').eq('client_intake_id', contextId).order('category'),
  ])

  if (leadRes.error) throw new Error(`client_intake: ${leadRes.error.message}`)
  const rawLead = leadRes.data as Row | null
  if (!rawLead || !rawLead.lead_status) throw new Error('Lead not found')

  for (const [label, result] of [
    ['lead_notes', notesRes],
    ['lead_meeting_notes', meetingsRes],
    ['lead_activity', activityRes],
    ['asset_intake', assetsRes],
  ] as const) {
    if (result.error) {
      console.warn(`[admin chat] lead context: ${label} query failed`, {
        leadId: contextId,
        error: result.error.message,
      })
    }
  }

  // A lead is matter-owned since unify_leads_matters, and the household
  // helpers are keyed by matter since step 3 of
  // docs/matter-contacts-migration.md. The lead row already carries its
  // matter, so no second lookup is needed — and none of the ambiguity that
  // resolving intake → matter would introduce.
  const leadMatterId = typeof rawLead.matter_id === 'string' ? rawLead.matter_id : null
  const spouse = leadMatterId ? await loadSpouseContact(admin, leadMatterId) : null
  const children = leadMatterId ? await loadHouseholdChildren(admin, leadMatterId) : []
  const lead: Row = {
    ...rawLead,
    spouse_first_name: spouse?.first_name ?? null,
    spouse_last_name: spouse?.last_name ?? null,
    spouse_name: spouse
      ? [spouse.first_name, spouse.last_name].filter(Boolean).join(' ') || null
      : null,
    spouse_email: spouse?.email ?? null,
    spouse_phone: spouse?.phone ?? null,
    spouse_date_of_birth: spouse?.date_of_birth ?? null,
    children,
  }
  const timeline = [
    ...((notesRes.data ?? []) as Row[]).map(row => `${text(row.created_at)} [note] ${text(row.body)}`),
    ...((meetingsRes.data ?? []) as Row[]).map(row => `${text(row.meeting_date)} [meeting: ${text(row.title)}] ${text(row.body)}`),
    ...((activityRes.data ?? []) as Row[]).map(row => `${text(row.created_at)} [activity: ${text(row.title)}] ${text(row.detail)}`),
  ].sort().reverse().slice(0, 12).map(line => `- ${line}`).join('\n') || '-'

  const firm = getFirmConfig()
  const systemPrompt = `You are an AI legal assistant for ${firm.attorneyShortName}, a Massachusetts estate planning attorney at ${firm.firmName}.

You have full context for this prospective client lead:

LEAD: ${fullName(lead)}
LEAD STATUS: ${text(lead.lead_status)}
PRACTICE AREA: ${text(lead.practice_area)}
SOURCE: ${text(lead.lead_source)}
URGENCY: ${text(lead.lead_urgency)}
QUALIFICATION NOTES: ${text(lead.qualification_notes)}
ENGAGEMENT: ${text(lead.engagement_status)}; quoted fee ${text(lead.engagement_fee_quoted)}
${quoteUserContent('client-intake-questionnaire', formatIntakeQuestionnaire(lead))}
ASSETS:
${quoteUserContent('client-reported-assets', summarizeAssets(lead, null, (assetsRes.data ?? []) as Row[]))}
FAMILY:
${summarizeFamily(lead, null)}
RECENT LEAD TIMELINE:
${quoteUserContent('lead-timeline', timeline)}

Respond in plain, concise attorney-facing language. Treat this record as a lead, not an active matter. You may draft text when asked. Always flag uncertainty and missing intake facts. Do not invent facts.

${PROMPT_INJECTION_GUARDRAIL}`

  return { systemPrompt, matterLabel: fullName(lead) }
}

export async function buildContext(contextType: ChatContextType, contextId?: string): Promise<MatterContext> {
  if (contextType === 'matter') {
    if (!contextId) throw new Error('context_id required for matter chat')
    return loadMatterContext(contextId)
  }
  if (contextType === 'lead') {
    if (!contextId) throw new Error('context_id required for lead chat')
    return loadLeadContext(contextId)
  }
  return {
    systemPrompt: await generalSystemPrompt(),
    matterLabel: null,
  }
}

export function sse(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`
}

/** A tool the chat loop can call: Anthropic schema + server-side executor. */
export type AdminChatToolEmit = (data: Record<string, unknown>) => void

export interface AdminChatToolExecutor {
  tool: Anthropic.Tool
  execute: (
    input: unknown,
    ctx: { toolUseId: string; emit: AdminChatToolEmit },
  ) => Promise<{ content: string; isError?: boolean }>
}

export interface AdminChatStreamOptions {
  system: string
  messages: Anthropic.MessageParam[]
  tools?: AdminChatToolExecutor[]
  /** Defensive cap on tool-use rounds. The floating panel uses 4; the assistant page 6. */
  maxIterations?: number
  /** Emitted before the model stream starts (e.g. a context-load warning). */
  preamble?: string
  /**
   * Non-text events the route already knows before the model speaks (e.g. the
   * workflow it injected). Emitted after the preamble and handed to onEvent so
   * they persist and replay like any tool event.
   */
  initialEvents?: Record<string, unknown>[]
  usage: {
    route: string
    contextType: ChatContextType
    matterId?: string | null
    userId?: string | null
  }
  /** Observe every SSE data event (used to persist assistant messages/events). */
  onEvent?: (data: Record<string, unknown>) => void
  /**
   * Called after each tool round with the assistant's blocks and the results
   * handed back, so a route can persist what the model read and replay it on
   * later turns. Not sent to the client.
   */
  onToolRound?: (round: {
    assistantContent: Anthropic.ContentBlock[]
    toolResults: Anthropic.ToolResultBlockParam[]
  }) => void
  /** Called once the stream finishes (success or failure) with the accumulated text. */
  /** Backoff between retries of a failure that landed before any text. Tests set it to 1. */
  retryDelayMs?: number
  /** `aborted` means the consumer hung up — persist the partial reply as shown. */
  onComplete?: (result: {
    text: string
    success: boolean
    errorMessage?: string
    aborted?: boolean
  }) => void | Promise<void>
}

/**
 * Run the Anthropic streaming tool loop and return it as an SSE Response.
 * Extracted from app/api/admin/chat/route.ts so the floating chat panel and
 * the dedicated assistant page share one engine.
 */
/** Mirrors the retry policy in lib/anthropic.ts: transport, 408, 429 and 5xx. */
function isRetryableStreamError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const status = (error as { status?: number; statusCode?: number }).status
    ?? (error as { status?: number; statusCode?: number }).statusCode
  if (status === undefined) return true
  if (status === 408 || status === 429) return true
  return status >= 500 && status < 600
}

export function createAdminChatStream(options: AdminChatStreamOptions): Response {
  const { system, messages, tools = [], maxIterations = 4, preamble, initialEvents = [], usage, onEvent, onToolRound, onComplete, retryDelayMs = 500 } = options
  const encoder = new TextEncoder()
  const executorsByName = new Map(tools.map(executor => [executor.tool.name, executor]))
  const anthropicTools = tools.map(executor => executor.tool)

  // Shared with cancel(): the consumer can go away at any point, and when it
  // does we stop the model rather than paying for tokens nobody will read.
  let abortActiveStream: (() => void) | null = null
  let clientGone = false

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now()
      const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      let accumulatedText = ''
      let closed = false
      /** Writing to a controller the consumer has dropped throws; that is not an error. */
      const write = (chunk: string) => {
        if (closed || clientGone) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // Already closed by a cancelling consumer.
        }
      }
      const emit = (data: Record<string, unknown>) => {
        write(sse(data))
        if (typeof data.text === 'string') accumulatedText += data.text
        onEvent?.(data)
      }
      /**
       * Open the model stream, retrying a transient failure only while the
       * attorney has seen nothing yet. Once text is on screen a retry would
       * repeat it, so the failure surfaces instead.
       */
      const openStream = async <T>(open: () => T): Promise<T> => {
        for (let attempt = 1; ; attempt++) {
          try {
            return open()
          } catch (error) {
            const last = attempt >= 3
            if (last || accumulatedText !== '' || !isRetryableStreamError(error)) throw error
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * 2 ** (attempt - 1)))
          }
        }
      }

      const chatModel = await resolveFirmModel('assistant')
      let usageModel = chatModel
      const anthropic = await getAnthropicClient()
      try {
        if (preamble) emit({ text: preamble })
        for (const event of initialEvents) emit(event)

        const conversation: Anthropic.MessageParam[] = [...messages]

        // Tool-use loop. We cap iterations defensively.
        for (let iteration = 0; iteration < maxIterations; iteration++) {
          if (clientGone) break
          const anthropicStream = await openStream(() => anthropic.messages.stream({
            model: chatModel,
            max_tokens: 4096,
            // Cache the large matter context prompt so the tool loop and
            // follow-up turns read it at ~10% of input cost. Below the model's
            // minimum cacheable prefix (small general prompts) this is a no-op.
            system: [
              {
                type: 'text' as const,
                text: system,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
            messages: conversation,
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
          }))

          abortActiveStream = () => anthropicStream.abort()

          for await (const event of anthropicStream) {
            if (clientGone) break
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              emit({ text: event.delta.text })
            }
          }

          const finalMessage = await anthropicStream.finalMessage()
          if (finalMessage.model) usageModel = finalMessage.model
          usageTotals.input += finalMessage.usage?.input_tokens ?? 0
          usageTotals.output += finalMessage.usage?.output_tokens ?? 0
          usageTotals.cacheRead += finalMessage.usage?.cache_read_input_tokens ?? 0
          usageTotals.cacheWrite += finalMessage.usage?.cache_creation_input_tokens ?? 0

          if (finalMessage.stop_reason !== 'tool_use') {
            break
          }

          const toolUseBlocks = finalMessage.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
          )

          conversation.push({ role: 'assistant', content: finalMessage.content })

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const block of toolUseBlocks) {
            const executor = executorsByName.get(block.name)
            if (!executor) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: 'Tool not available in this context.' }),
                is_error: true,
              })
              continue
            }
            emit({ tool: block.name, tool_use_id: block.id, status: 'running' })
            try {
              const result = await executor.execute(block.input, { toolUseId: block.id, emit })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.content,
                ...(result.isError ? { is_error: true } : {}),
              })
            } catch (toolError) {
              const message = (toolError as Error).message ?? 'Unknown error'
              emit({ tool: block.name, tool_use_id: block.id, status: 'error', error: message })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: message }),
                is_error: true,
              })
            }
          }

          conversation.push({ role: 'user', content: toolResults })
          onToolRound?.({ assistantContent: finalMessage.content, toolResults })

          if (iteration === maxIterations - 1) {
            // Falling out of the loop here used to emit [DONE] over a partial
            // answer with no signal that the assistant had more to do.
            emit({ text: '\n\n_(Stopped: tool loop limit reached. Ask me to continue.)_' })
          }
        }

        write('data: [DONE]\n\n')
        close()

        void logAiUsage({
          route: usage.route,
          contextType: usage.contextType,
          matterId: usage.matterId ?? null,
          userId: usage.userId ?? null,
          model: usageModel,
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output,
          cacheReadInputTokens: usageTotals.cacheRead,
          cacheCreationInputTokens: usageTotals.cacheWrite,
          durationMs: Date.now() - startedAt,
          success: true,
        })
        await onComplete?.({ text: accumulatedText, success: true, ...(clientGone ? { aborted: true } : {}) })
      } catch (error) {
        if (clientGone) {
          // The consumer cancelled mid-stream; the abort surfaces here.
          close()
          await onComplete?.({ text: accumulatedText, success: true, aborted: true })
          return
        }
        console.error(`[${usage.route}] anthropic stream failed`, error)
        write(sse({ error: 'Chat unavailable - try again in a moment.' }))
        close()
        void logAiUsage({
          route: usage.route,
          contextType: usage.contextType,
          matterId: usage.matterId ?? null,
          userId: usage.userId ?? null,
          model: usageModel,
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output,
          cacheReadInputTokens: usageTotals.cacheRead,
          cacheCreationInputTokens: usageTotals.cacheWrite,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        await onComplete?.({
          text: accumulatedText,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    },
    cancel() {
      // The attorney pressed Stop, or the tab went away. Stop generating and
      // let start() persist exactly what was streamed, so a reload shows the
      // same answer the attorney saw.
      clientGone = true
      abortActiveStream?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
