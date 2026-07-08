import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  createMcpConnector,
  listMcpConnectors,
  type McpAuthMode,
  type McpTransport,
} from '@/lib/mcpConnectors'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** GET /api/admin/me/connectors */
export async function GET(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  try {
    const connectors = await listMcpConnectors(admin, user.id)
    return NextResponse.json({ connectors })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('user_mcp_connectors') || message.includes('schema cache')) {
      return NextResponse.json({ connectors: [], unavailable: true })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** POST /api/admin/me/connectors */
export async function POST(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    name?: string
    serverUrl?: string
    transport?: McpTransport
    authMode?: McpAuthMode
    authSecret?: string
    enabled?: boolean
  } | null

  if (!body?.name?.trim() || !body?.serverUrl?.trim()) {
    return NextResponse.json({ error: 'name and serverUrl are required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const result = await createMcpConnector(admin, user.id, {
    name: body.name,
    serverUrl: body.serverUrl,
    transport: body.transport,
    authMode: body.authMode,
    authSecret: body.authSecret,
    enabled: body.enabled,
  })
  if (!result.ok) {
    const status = result.error.includes('ENCRYPTION_SECRET') ? 501 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ connector: result.connector }, { status: 201 })
}
