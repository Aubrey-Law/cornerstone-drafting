/**
 * Staff MCP connector CRUD helpers (storage + encryption).
 * Full MCP runtime (tool listing / calling) is phased — this lands schema + secure storage.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSecretBoxConfigured, openSecret, sealSecret } from '@/lib/secretBox'

export type McpTransport = 'streamable_http' | 'sse'
export type McpAuthMode = 'none' | 'bearer' | 'oauth'

export interface McpConnectorPublic {
  id: string
  name: string
  transport: McpTransport
  serverUrl: string
  enabled: boolean
  authMode: McpAuthMode
  hasAuthConfig: boolean
  createdAt: string
  updatedAt: string
}

export interface McpConnectorInput {
  name: string
  serverUrl: string
  transport?: McpTransport
  authMode?: McpAuthMode
  enabled?: boolean
  /** Bearer token or JSON auth blob — never returned on GET. */
  authSecret?: string | null
}

type Row = {
  id: string
  name: string
  transport: string
  server_url: string
  enabled: boolean
  auth_mode: string
  encrypted_auth_config: string | null
  auth_config_iv: string | null
  auth_config_tag: string | null
  created_at: string
  updated_at: string
}

function toPublic(row: Row): McpConnectorPublic {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransport,
    serverUrl: row.server_url,
    enabled: row.enabled,
    authMode: row.auth_mode as McpAuthMode,
    hasAuthConfig: Boolean(row.encrypted_auth_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listMcpConnectors(
  admin: SupabaseClient,
  userId: string,
): Promise<McpConnectorPublic[]> {
  const { data, error } = await admin
    .from('user_mcp_connectors')
    .select(
      'id, name, transport, server_url, enabled, auth_mode, encrypted_auth_config, auth_config_iv, auth_config_tag, created_at, updated_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => toPublic(row as Row))
}

export async function createMcpConnector(
  admin: SupabaseClient,
  userId: string,
  input: McpConnectorInput,
): Promise<{ ok: true; connector: McpConnectorPublic } | { ok: false; error: string }> {
  const name = input.name.trim()
  const serverUrl = input.serverUrl.trim()
  if (!name) return { ok: false, error: 'name is required' }
  if (!serverUrl) return { ok: false, error: 'serverUrl is required' }

  let encrypted: string | null = null
  let iv: string | null = null
  let tag: string | null = null
  const authSecret = input.authSecret?.trim()
  if (authSecret) {
    if (!isSecretBoxConfigured()) {
      return { ok: false, error: 'USER_API_KEYS_ENCRYPTION_SECRET is not configured' }
    }
    const sealed = sealSecret(authSecret)
    encrypted = sealed.ciphertext
    iv = sealed.iv
    tag = sealed.authTag
  }

  const { data, error } = await admin
    .from('user_mcp_connectors')
    .insert({
      user_id: userId,
      name,
      server_url: serverUrl,
      transport: input.transport ?? 'streamable_http',
      auth_mode: input.authMode ?? (authSecret ? 'bearer' : 'none'),
      enabled: input.enabled ?? true,
      encrypted_auth_config: encrypted,
      auth_config_iv: iv,
      auth_config_tag: tag,
    })
    .select(
      'id, name, transport, server_url, enabled, auth_mode, encrypted_auth_config, auth_config_iv, auth_config_tag, created_at, updated_at',
    )
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert failed' }
  return { ok: true, connector: toPublic(data as Row) }
}

export async function updateMcpConnector(
  admin: SupabaseClient,
  userId: string,
  connectorId: string,
  patch: Partial<McpConnectorInput>,
): Promise<{ ok: true; connector: McpConnectorPublic } | { ok: false; error: string }> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof patch.name === 'string') updates.name = patch.name.trim()
  if (typeof patch.serverUrl === 'string') updates.server_url = patch.serverUrl.trim()
  if (patch.transport) updates.transport = patch.transport
  if (patch.authMode) updates.auth_mode = patch.authMode
  if (typeof patch.enabled === 'boolean') updates.enabled = patch.enabled

  if (patch.authSecret !== undefined) {
    const authSecret = patch.authSecret?.trim() ?? ''
    if (!authSecret) {
      updates.encrypted_auth_config = null
      updates.auth_config_iv = null
      updates.auth_config_tag = null
    } else {
      if (!isSecretBoxConfigured()) {
        return { ok: false, error: 'USER_API_KEYS_ENCRYPTION_SECRET is not configured' }
      }
      const sealed = sealSecret(authSecret)
      updates.encrypted_auth_config = sealed.ciphertext
      updates.auth_config_iv = sealed.iv
      updates.auth_config_tag = sealed.authTag
    }
  }

  const { data, error } = await admin
    .from('user_mcp_connectors')
    .update(updates)
    .eq('id', connectorId)
    .eq('user_id', userId)
    .select(
      'id, name, transport, server_url, enabled, auth_mode, encrypted_auth_config, auth_config_iv, auth_config_tag, created_at, updated_at',
    )
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Not found' }
  return { ok: true, connector: toPublic(data as Row) }
}

export async function deleteMcpConnector(
  admin: SupabaseClient,
  userId: string,
  connectorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin
    .from('user_mcp_connectors')
    .delete()
    .eq('id', connectorId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Decrypt connector bearer/auth blob for future MCP runtime use. */
export async function loadMcpAuthSecret(
  admin: SupabaseClient,
  userId: string,
  connectorId: string,
): Promise<string | null> {
  if (!isSecretBoxConfigured()) return null
  const { data } = await admin
    .from('user_mcp_connectors')
    .select('encrypted_auth_config, auth_config_iv, auth_config_tag')
    .eq('id', connectorId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data?.encrypted_auth_config || !data.auth_config_iv || !data.auth_config_tag) return null
  return openSecret({
    ciphertext: data.encrypted_auth_config,
    iv: data.auth_config_iv,
    authTag: data.auth_config_tag,
  })
}
