import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { probeMcpServer } from '@/lib/mcpClient'
import { loadMcpAuthSecret } from '@/lib/mcpConnectors'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** POST /api/admin/me/connectors/[id]/test — probe MCP initialize + tools/list */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = getAdminClient()
  const { data: row } = await admin
    .from('user_mcp_connectors')
    .select('id, name, server_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const authSecret = await loadMcpAuthSecret(admin, user.id, id)
  const result = await probeMcpServer({
    serverUrl: row.server_url,
    authSecret,
  })

  return NextResponse.json({
    connectorId: id,
    connectorName: row.name,
    ...result,
  })
}
