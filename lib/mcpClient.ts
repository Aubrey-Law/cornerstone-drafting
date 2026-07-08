/**
 * MCP streamable-HTTP client for connector probe + drafting assistant tool calls.
 */

const MCP_PROTOCOL_VERSION = '2024-11-05'

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpSession {
  serverUrl: string
  authSecret?: string | null
  sessionId: string | null
  serverName?: string
}

let rpcId = 1

function nextRpcId(): number {
  rpcId += 1
  return rpcId
}

async function mcpRequest(
  serverUrl: string,
  method: string,
  params: Record<string, unknown>,
  authSecret?: string | null,
  sessionId?: string | null,
): Promise<{ result?: unknown; error?: string; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (authSecret?.trim()) {
    headers.Authorization = `Bearer ${authSecret.trim()}`
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  const res = await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId(), method, params }),
    signal: AbortSignal.timeout(30_000),
  })

  const nextSession = res.headers.get('mcp-session-id') ?? sessionId ?? undefined
  const contentType = res.headers.get('content-type') ?? ''

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { error: text || `HTTP ${res.status}`, sessionId: nextSession }
  }

  if (contentType.includes('text/event-stream')) {
    const text = await res.text()
    const dataLine = text.split('\n').find(line => line.startsWith('data: '))
    if (!dataLine) return { error: 'Empty SSE response from MCP server', sessionId: nextSession }
    try {
      const parsed = JSON.parse(dataLine.slice(6)) as JsonRpcResponse
      if (parsed.error?.message) return { error: parsed.error.message, sessionId: nextSession }
      return { result: parsed.result, sessionId: nextSession }
    } catch {
      return { error: 'Invalid SSE JSON from MCP server', sessionId: nextSession }
    }
  }

  const parsed = (await res.json().catch(() => null)) as JsonRpcResponse | null
  if (!parsed) return { error: 'Invalid JSON from MCP server', sessionId: nextSession }
  if (parsed.error?.message) return { error: parsed.error.message, sessionId: nextSession }
  return { result: parsed.result, sessionId: nextSession }
}

export async function establishMcpSession(args: {
  serverUrl: string
  authSecret?: string | null
}): Promise<{ ok: true; session: McpSession } | { ok: false; error: string }> {
  const url = args.serverUrl.trim()
  if (!url) return { ok: false, error: 'serverUrl is required' }

  try {
    const init = await mcpRequest(
      url,
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'cornerstone-drafting', version: '1.0.0' },
      },
      args.authSecret,
    )
    if (init.error) return { ok: false, error: init.error }

    const sessionId = init.sessionId ?? null
    const serverName =
      typeof init.result === 'object' && init.result && 'serverInfo' in init.result
        ? String((init.result as { serverInfo?: { name?: string } }).serverInfo?.name ?? '')
        : undefined

    await mcpRequest(url, 'notifications/initialized', {}, args.authSecret, sessionId).catch(
      () => undefined,
    )

    return {
      ok: true,
      session: {
        serverUrl: url,
        authSecret: args.authSecret,
        sessionId,
        serverName: serverName || undefined,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'MCP connect failed' }
  }
}

export async function listMcpTools(session: McpSession): Promise<McpToolDefinition[]> {
  const res = await mcpRequest(
    session.serverUrl,
    'tools/list',
    {},
    session.authSecret,
    session.sessionId,
  )
  if (res.error || !res.result) return []

  const toolsRaw =
    typeof res.result === 'object' && res.result && 'tools' in res.result
      ? (res.result as { tools?: Array<Record<string, unknown>> }).tools
      : []

  return (toolsRaw ?? [])
    .map(t => ({
      name: String(t.name ?? '').trim(),
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema:
        typeof t.inputSchema === 'object' && t.inputSchema
          ? (t.inputSchema as Record<string, unknown>)
          : typeof t.input_schema === 'object' && t.input_schema
            ? (t.input_schema as Record<string, unknown>)
            : { type: 'object', properties: {} },
    }))
    .filter(t => t.name.length > 0)
}

export async function callMcpTool(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const res = await mcpRequest(
    session.serverUrl,
    'tools/call',
    { name: toolName, arguments: args },
    session.authSecret,
    session.sessionId,
  )
  if (res.error) return { ok: false, error: res.error }

  const result = res.result
  if (typeof result !== 'object' || !result) {
    return { ok: true, text: JSON.stringify(result ?? null) }
  }

  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
  if (Array.isArray(content)) {
    const text = content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n')
    if (text) return { ok: true, text }
  }

  if ('structuredContent' in result) {
    return { ok: true, text: JSON.stringify((result as { structuredContent: unknown }).structuredContent) }
  }

  return { ok: true, text: JSON.stringify(result) }
}

export interface McpProbeResult {
  ok: boolean
  serverName?: string
  tools: string[]
  error?: string
}

/** Initialize an MCP server and list tool names (best-effort). */
export async function probeMcpServer(args: {
  serverUrl: string
  authSecret?: string | null
}): Promise<McpProbeResult> {
  const established = await establishMcpSession(args)
  if (!established.ok) {
    return { ok: false, tools: [], error: established.error }
  }

  const tools = await listMcpTools(established.session)
  return {
    ok: true,
    serverName: established.session.serverName,
    tools: tools.map(t => t.name),
  }
}
