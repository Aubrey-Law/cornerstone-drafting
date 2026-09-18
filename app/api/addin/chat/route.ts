import { requireAdmin } from '@/lib/apiAuth'
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { getFirmConfig } from '@/lib/firmConfig'
import { consumeRateLimit } from '@/lib/rateLimit'
import { createAdminChatStream, DESIGN_SHEET_STATUS_TOOL_NAME, type ChatContextType } from '@/lib/adminChat/engine'
import { adminChatToolset } from '@/lib/adminChat/toolset'
import { READ_MATTER_RECORD_TOOL_NAME } from '@/lib/adminChat/matterKnowledgeTools'
import { forEachSseFrame } from '@/app/admin/components/chatStream'
import {
  MAX_DOCUMENT_CONTEXT_CHARS,
  buildEditProtocolInstructions,
} from '@/lib/drafting/editProtocol'
import { buildMatterBrief, matterBriefPromptSection } from '@/lib/drafting/matterBrief'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Matches the admin chat lane: generous enough to work, tight enough to notice abuse. */
const RATE_LIMIT = { bucket: 'addin_chat', limit: 60, windowSeconds: 600 }

const MAX_HISTORY_MESSAGES = 24

interface AddinChatBody {
  messages?: Array<{ role?: string; content?: string }>
  /** The open document, rendered as structure-annotated markdown by the pane. */
  documentText?: string
  documentName?: string
  /**
   * The matter the attorney linked this document to. When set, its design
   * sheet is the source of truth for the facts in the draft.
   */
  matterId?: string
}

function sse(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function buildSystemPrompt(documentName: string | null, matterSection: string | null): string {
  const firm = getFirmConfig()
  return `You are the drafting assistant for ${firm.firmName}, a Massachusetts estate-planning practice, running inside Microsoft Word.

You are looking at ${documentName ? `"${documentName}"` : 'the document the attorney has open'}. Be precise and professional. Answer from the document in front of you; never invent its contents.

The document reaches you as markdown whose structure markers — leading "#" on headings, list markers and their indentation, and table pipes — are added by the renderer and are NOT characters in the Word document. Never include them in text you quote back.
${matterSection ? `\n${matterSection}\n` : ''}
${buildEditProtocolInstructions()}

IN WORD: Your tools here are read-only. Use \`${READ_MATTER_RECORD_TOOL_NAME}\` for the matter's people, notes, tasks, documents and dates when the design sheet above does not answer, and \`${DESIGN_SHEET_STATUS_TOOL_NAME}\` for what the sheet still needs. You cannot propose tasks, holds or design-sheet changes from Word; when one is needed, say so and point the attorney to the matter in the web app.

${PROMPT_INJECTION_GUARDRAIL}`
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId!

  const limit = await consumeRateLimit(RATE_LIMIT, userId)
  if (!limit.ok) {
    return new Response(JSON.stringify({ error: 'Too many requests. Try again shortly.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(limit.retryAfterSeconds) },
    })
  }

  const body = (await req.json().catch(() => null)) as AddinChatBody | null
  if (!body) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = (body.messages ?? [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }))

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ error: 'Expected a trailing user message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // The document is untrusted input — an estate-planning draft can contain any
  // text a client typed into intake. Fence it so instructions inside it read as
  // content, matching how the rest of the app handles client-supplied text.
  const documentText = (body.documentText ?? '').slice(0, MAX_DOCUMENT_CONTEXT_CHARS)
  if (documentText) {
    const last = messages[messages.length - 1]
    last.content = `${quoteUserContent('open-word-document', documentText)}\n\nAttorney request:\n${last.content}`
  }

  /*
   * The linked matter's design sheet.
   *
   * Rebuilt every turn rather than cached, for the reason the pane re-reads the
   * document every turn: the attorney may have settled a fiduciary in the web
   * app mid-conversation, and a sheet read once at the start would keep drafting
   * from the answer they just changed. It lands in the system prompt, which is
   * stable across turns and so stays cacheable upstream.
   *
   * Failure here never fails the turn — an unready sheet would otherwise cost
   * the attorney the message they just typed — but it is always reported.
   * Silently dropping the brief would leave them drafting against a model they
   * believe knows the client's fiduciaries and does not, which is worse than
   * the error: the answers would look the same and be invented.
   */
  const matterId = typeof body.matterId === 'string' && body.matterId ? body.matterId : null
  const briefResult = matterId ? await buildMatterBrief(matterId) : null
  const matterSection = briefResult?.ok ? matterBriefPromptSection(briefResult.brief) : null
  const matterContext = !matterId
    ? { state: 'none' as const }
    : briefResult?.ok
      ? { state: 'applied' as const, matterNumber: briefResult.brief.matterNumber, clientName: briefResult.brief.clientName }
      : { state: 'unavailable' as const, reason: briefResult?.reason ?? 'Design sheet unavailable' }

  // The shared engine, with the read-only tool set: the pane renders text and
  // applies <EDITS>, but has no card for a proposal or a download.
  const contextType: ChatContextType = matterId ? 'matter' : 'general'
  const toolset = adminChatToolset({
    contextType,
    contextId: matterId,
    user: { id: userId, email: auth.user?.email ?? null, user_metadata: auth.user?.user_metadata },
    surface: 'addin',
  })

  const engineResponse = createAdminChatStream({
    system: buildSystemPrompt(body.documentName ?? null, matterSection) + toolset.promptNotes,
    messages,
    tools: toolset.tools,
    maxIterations: 4,
    // Long <EDITS> blocks need more room than a chat reply.
    maxTokens: 8192,
    usage: { route: 'addin/chat', contextType, matterId, userId },
  })

  /*
   * Translate the engine's frames into the dialect the deployed add-in reads:
   * `{delta}` per text chunk and one terminal `{done, reply, matterContext}`.
   * The pane parses the <EDITS> block from that complete reply, never from the
   * deltas — a truncated `original` would still match somewhere in the
   * document, at the wrong boundary. Translating here means an add-in already
   * installed in Word keeps working against the new engine.
   */
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(sse(data)))
        } catch {
          // Client hung up mid-stream; nothing to do but stop writing.
        }
      }
      let reply = ''
      let failed = false
      try {
        if (!engineResponse.body) throw new Error('Chat stream unavailable')
        await forEachSseFrame(engineResponse.body, frame => {
          if (frame.error && !frame.tool) {
            failed = true
            send({ error: frame.error })
            return
          }
          if (frame.tool && frame.tool_use_id && frame.status) {
            // A status line for the pane, if it ever chooses to show one; the
            // current pane ignores keys it does not know.
            send({ tool: frame.tool, status: frame.status })
            return
          }
          if (typeof frame.text === 'string' && frame.text) {
            reply += frame.text
            send({ delta: frame.text })
          }
        })
        if (!failed) send({ done: true, reply, matterContext })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat failed'
        console.error('[addin/chat]', err)
        send({ error: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx and similar proxies buffer SSE into one blob without this.
      'X-Accel-Buffering': 'no',
    },
  })
}
