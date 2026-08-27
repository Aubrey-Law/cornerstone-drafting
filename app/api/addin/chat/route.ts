import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { getFirmConfig } from '@/lib/firmConfig'
import { logAiUsage } from '@/lib/aiUsage'
import { consumeRateLimit } from '@/lib/rateLimit'
import { runLlmChat, resolveLlmConfig, type LlmMessage } from '@/lib/llm'
import {
  MAX_DOCUMENT_CONTEXT_CHARS,
  buildEditProtocolInstructions,
} from '@/lib/drafting/editProtocol'

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
  /** Optional matter to pull drafting context from. Reserved; not yet used. */
  matterId?: string
}

function sse(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function buildSystemPrompt(documentName: string | null): string {
  const firm = getFirmConfig()
  return `You are the drafting assistant for ${firm.firmName}, a Massachusetts estate-planning practice, running inside Microsoft Word.

You are looking at ${documentName ? `"${documentName}"` : 'the document the attorney has open'}. Be precise and professional. Answer from the document in front of you; never invent its contents.

The document reaches you as markdown whose structure markers — leading "#" on headings, list markers and their indentation, and table pipes — are added by the renderer and are NOT characters in the Word document. Never include them in text you quote back.

${buildEditProtocolInstructions()}

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

  const messages: LlmMessage[] = (body.messages ?? [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }))

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ error: 'Expected a trailing user message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = getAdminClient()
  const llm = await resolveLlmConfig(admin, userId)
  if (!llm.ok) {
    return new Response(JSON.stringify({ error: llm.error }), {
      status: 501,
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

  const startedAt = Date.now()
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

      try {
        const result = await runLlmChat(llm.config, {
          system: buildSystemPrompt(body.documentName ?? null),
          messages,
          maxTokens: 8192,
          hooks: { onDelta: text => send({ delta: text }) },
        })

        // The pane parses the <EDITS> block from the complete reply, never from
        // the deltas: a truncated `original` would still match somewhere in the
        // document, at the wrong boundary.
        send({ done: true, reply: result.reply })

        await logAiUsage({
          route: 'addin/chat',
          userId,
          matterId: body.matterId ?? null,
          model: result.model,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          cacheReadInputTokens: result.usage?.cacheReadInputTokens,
          cacheCreationInputTokens: result.usage?.cacheCreationInputTokens,
          durationMs: Date.now() - startedAt,
          success: true,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat failed'
        console.error('[addin/chat]', err)
        send({ error: message })
        await logAiUsage({
          route: 'addin/chat',
          userId,
          matterId: body.matterId ?? null,
          model: llm.config.model,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: message,
        })
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
