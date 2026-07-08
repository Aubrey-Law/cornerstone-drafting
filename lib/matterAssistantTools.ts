import type { SupabaseClient } from '@supabase/supabase-js'
import type { LlmToolDefinition } from '@/lib/llm/types'
import {
  callMcpTool,
  establishMcpSession,
  listMcpTools,
  type McpSession,
  type McpToolDefinition,
} from '@/lib/mcpClient'
import { listMcpConnectors, loadMcpAuthSecret } from '@/lib/mcpConnectors'

const MAX_CONNECTORS = 3
const MAX_TOOLS = 24
const TOOL_NAME_PREFIX = 'mcp_'

export interface RegisteredMcpTool {
  /** Provider-safe tool name */
  llmName: string
  connectorId: string
  connectorName: string
  mcpToolName: string
  session: McpSession
  definition: McpToolDefinition
}

function llmToolName(connectorId: string, mcpToolName: string): string {
  const safe = `${connectorId.slice(0, 8)}_${mcpToolName}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${TOOL_NAME_PREFIX}${safe}`.slice(0, 128)
}

function parseLlmToolName(name: string, registry: RegisteredMcpTool[]): RegisteredMcpTool | null {
  if (!name.startsWith(TOOL_NAME_PREFIX)) return null
  return registry.find(t => t.llmName === name) ?? null
}

export async function loadMcpToolsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{ tools: LlmToolDefinition[]; registry: RegisteredMcpTool[] }> {
  const connectors = (await listMcpConnectors(admin, userId))
    .filter(c => c.enabled)
    .slice(0, MAX_CONNECTORS)

  const registry: RegisteredMcpTool[] = []

  for (const connector of connectors) {
    const authSecret = await loadMcpAuthSecret(admin, userId, connector.id)
    const established = await establishMcpSession({
      serverUrl: connector.serverUrl,
      authSecret,
    })
    if (!established.ok) continue

    const mcpTools = await listMcpTools(established.session)
    for (const def of mcpTools) {
      if (registry.length >= MAX_TOOLS) break
      const name = llmToolName(connector.id, def.name)
      registry.push({
        llmName: name,
        connectorId: connector.id,
        connectorName: connector.name,
        mcpToolName: def.name,
        session: established.session,
        definition: def,
      })
    }
  }

  const tools: LlmToolDefinition[] = registry.map(entry => ({
    name: entry.llmName,
    description: `[${entry.connectorName}] ${entry.definition.description ?? entry.mcpToolName}`,
    inputSchema: (entry.definition.inputSchema ?? {
      type: 'object',
      properties: {},
    }) as Record<string, unknown>,
  }))

  return { tools, registry }
}

export async function executeMcpToolCall(
  registry: RegisteredMcpTool[],
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ ok: true; text: string; connectorName: string; mcpToolName: string } | { ok: false; error: string }> {
  const entry = parseLlmToolName(toolName, registry)
  if (!entry) return { ok: false, error: `Unknown tool: ${toolName}` }

  const result = await callMcpTool(entry.session, entry.mcpToolName, toolInput)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  return {
    ok: true,
    text: result.text,
    connectorName: entry.connectorName,
    mcpToolName: entry.mcpToolName,
  }
}
