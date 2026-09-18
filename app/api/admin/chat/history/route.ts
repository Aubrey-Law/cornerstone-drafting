import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { appendRailTurns, clearRailThread, listRailThread, type RailChatContext } from '@/lib/railChatHistory'

/**
 * The rail's saved threads, one per attorney and context.
 *
 * GET    ?context_type=general|matter|lead[&context_id=]  → { turns }
 * PATCH  { context_type, context_id?, turns: 1–4 completed turns }
 * DELETE ?context_type=…[&context_id=]
 *
 * The chat itself still streams through /api/admin/chat; this route only
 * keeps what was said, the way the matter route already did for matters.
 */

function contextFrom(values: { context_type?: unknown; context_id?: unknown }): RailChatContext | NextResponse {
  const type = values.context_type
  if (type !== 'general' && type !== 'matter' && type !== 'lead') {
    return NextResponse.json({ error: 'Invalid context_type' }, { status: 400 })
  }
  if (type === 'general') return { type }
  const id = typeof values.context_id === 'string' ? values.context_id.trim() : ''
  if (!id) return NextResponse.json({ error: `context_id is required for ${type} threads` }, { status: 400 })
  return { type, id }
}

function contextFromQuery(req: Request) {
  const params = new URL(req.url).searchParams
  return contextFrom({ context_type: params.get('context_type') ?? undefined, context_id: params.get('context_id') ?? undefined })
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const context = contextFromQuery(req)
  if (context instanceof NextResponse) return context
  try {
    const turns = await listRailThread(getAdminClient(), context, auth.userId)
    return NextResponse.json({ turns })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load the thread' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as {
    context_type?: unknown
    context_id?: unknown
    turns?: Array<{ role?: unknown; content?: unknown }>
  } | null
  const context = contextFrom(body ?? {})
  if (context instanceof NextResponse) return context

  const rawTurns = body?.turns
  if (!Array.isArray(rawTurns) || rawTurns.length === 0 || rawTurns.length > 4) {
    return NextResponse.json({ error: 'turns must be an array of 1-4 items' }, { status: 400 })
  }
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const turn of rawTurns) {
    const content = typeof turn?.content === 'string' ? turn.content.trim() : ''
    if ((turn?.role !== 'user' && turn?.role !== 'assistant') || !content) {
      return NextResponse.json({ error: 'each turn needs a role and non-empty content' }, { status: 400 })
    }
    turns.push({ role: turn.role, content: content.slice(0, 32_000) })
  }

  try {
    await appendRailTurns(getAdminClient(), context, auth.userId, turns)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save the turns' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const context = contextFromQuery(req)
  if (context instanceof NextResponse) return context
  try {
    await clearRailThread(getAdminClient(), context, auth.userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to clear the thread' }, { status: 500 })
  }
}
