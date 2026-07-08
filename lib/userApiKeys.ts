/**
 * Staff BYOK provider keys — encrypt at rest, resolve user → env fallback.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSecretBoxConfigured, maskSecretHint, openSecret, sealSecret } from '@/lib/secretBox'

export type ApiKeyProvider = 'anthropic' | 'openai' | 'gemini'
export type ApiKeySource = 'user' | 'env' | null

export const API_KEY_PROVIDERS: ApiKeyProvider[] = ['anthropic', 'openai', 'gemini']

export interface ApiKeyStatusEntry {
  provider: ApiKeyProvider
  configured: boolean
  source: ApiKeySource
  hint: string | null
}

type EncryptedRow = {
  provider: string
  encrypted_key: string
  iv: string
  auth_tag: string
  key_hint: string | null
}

function envKey(provider: ApiKeyProvider): string | null {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim() || null
    case 'openai':
      return process.env.OPENAI_API_KEY?.trim() || null
    case 'gemini':
      return process.env.GEMINI_API_KEY?.trim() || null
  }
}

export function normalizeApiKeyProvider(value: string): ApiKeyProvider | null {
  const v = value.trim().toLowerCase()
  if (v === 'claude') return 'anthropic'
  return (API_KEY_PROVIDERS as string[]).includes(v) ? (v as ApiKeyProvider) : null
}

export async function listUserApiKeyStatus(
  admin: SupabaseClient,
  userId: string,
): Promise<ApiKeyStatusEntry[]> {
  const { data } = await admin
    .from('user_api_keys')
    .select('provider, encrypted_key, iv, auth_tag, key_hint')
    .eq('user_id', userId)

  const byProvider = new Map<string, EncryptedRow>()
  for (const row of data ?? []) {
    byProvider.set(row.provider, row as EncryptedRow)
  }

  return API_KEY_PROVIDERS.map(provider => {
    const row = byProvider.get(provider)
    if (row) {
      return {
        provider,
        configured: true,
        source: 'user' as const,
        hint: row.key_hint,
      }
    }
    const fromEnv = envKey(provider)
    return {
      provider,
      configured: Boolean(fromEnv),
      source: fromEnv ? ('env' as const) : null,
      hint: fromEnv ? maskSecretHint(fromEnv) : null,
    }
  })
}

export async function upsertUserApiKey(
  admin: SupabaseClient,
  userId: string,
  provider: ApiKeyProvider,
  plaintext: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSecretBoxConfigured()) {
    return { ok: false, error: 'USER_API_KEYS_ENCRYPTION_SECRET is not configured' }
  }
  const trimmed = plaintext.trim()
  if (!trimmed) return { ok: false, error: 'API key is required' }

  const sealed = sealSecret(trimmed)
  const now = new Date().toISOString()
  const { error } = await admin.from('user_api_keys').upsert(
    {
      user_id: userId,
      provider,
      encrypted_key: sealed.ciphertext,
      iv: sealed.iv,
      auth_tag: sealed.authTag,
      key_hint: maskSecretHint(trimmed),
      updated_at: now,
    },
    { onConflict: 'user_id,provider' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteUserApiKey(
  admin: SupabaseClient,
  userId: string,
  provider: ApiKeyProvider,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin
    .from('user_api_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Resolve plaintext key: user BYOK first, then process env. */
export async function resolveApiKey(
  admin: SupabaseClient,
  userId: string | null | undefined,
  provider: ApiKeyProvider,
): Promise<{ key: string; source: ApiKeySource } | { key: null; source: null }> {
  if (userId && isSecretBoxConfigured()) {
    const { data } = await admin
      .from('user_api_keys')
      .select('encrypted_key, iv, auth_tag')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle()
    if (data) {
      const opened = openSecret({
        ciphertext: data.encrypted_key,
        iv: data.iv,
        authTag: data.auth_tag,
      })
      if (opened) return { key: opened, source: 'user' }
    }
  }
  const fromEnv = envKey(provider)
  if (fromEnv) return { key: fromEnv, source: 'env' }
  return { key: null, source: null }
}
