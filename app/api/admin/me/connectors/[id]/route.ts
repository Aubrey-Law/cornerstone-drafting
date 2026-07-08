import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  deleteMcpConnector,
  updateMcpConnector,
  type McpAuthMode,
  type McpTransport,
} from '@/lib/mcpConnectors'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** PATCH /api/admin/me/connectors/[id] */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => null)) as {
    name?: string
    serverUrl?: string
    transport?: McpTransport
    authMode?: McpAuthMode
    authSecret?: string | null
    enabled?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const admin = getAdminClient()
  const result = await updateMcpConnector(admin, user.id, id, body)
  if (!result.ok) {
    const status = result.error === 'Not found' ? 404 : result.error.includes('ENCRYPTION_SECRET') ? 501 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ connector: result.connector })
}

/** DELETE /api/admin/me/connectors/[id] */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = getAdminClient()
  const result = await deleteMcpConnector(admin, user.id, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
