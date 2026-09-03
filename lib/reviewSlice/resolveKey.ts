import type { SupabaseClient } from '@supabase/supabase-js'
import { isSecretBoxConfigured, openSecret } from '@/lib/secretBox'

/**
 * Finding the Anthropic key from a shell.
 *
 * The app resolves it **user-first**: a key entered in Settings → API keys is
 * stored encrypted in `user_api_keys` and takes precedence over the
 * environment. A CLI has no signed-in user, so a naive script sees only
 * `ANTHROPIC_API_KEY` — and reports "could not resolve authentication method"
 * on a machine where the app itself works fine, which is a confusing thing to
 * be told.
 *
 * So this looks in both places, in the app's own order, and when it finds
 * nothing it says which places it looked rather than leaving that to be
 * inferred from an SDK error.
 */

export type KeySource = 'env' | 'settings'

export type ResolveKeyResult =
  | { ok: true; key: string; source: KeySource }
  | { ok: false; message: string }

function envKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim() || null
}

/**
 * Reads the key a person saved in Settings.
 *
 * There is no signed-in user here, so the row is chosen by there being exactly
 * one. That is the right rule for a single-attorney firm and the right refusal
 * for anything else: picking one of several people's keys arbitrarily would
 * bill the wrong account and be invisible while doing it.
 */
type SettingsKeyResult = { key: string; reason?: undefined } | { key: null; reason: string }

async function settingsKey(admin: SupabaseClient): Promise<SettingsKeyResult> {
  if (!isSecretBoxConfigured()) {
    return { key: null, reason: 'USER_API_KEYS_ENCRYPTION_SECRET is not set, so a key saved in Settings cannot be decrypted here.' }
  }

  const { data, error } = await admin
    .from('user_api_keys')
    .select('user_id, encrypted_key, iv, auth_tag')
    .eq('provider', 'anthropic')

  if (error) return { key: null, reason: `Could not read saved keys: ${error.message}` }

  const rows = data ?? []
  if (rows.length === 0) return { key: null, reason: 'No Anthropic key is saved in Settings.' }
  if (rows.length > 1) {
    return {
      key: null,
      reason: `${rows.length} people have saved an Anthropic key, so this cannot tell whose to use. Set ANTHROPIC_API_KEY in .env.local instead.`,
    }
  }

  const row = rows[0] as { encrypted_key: string; iv: string; auth_tag: string }
  const opened = openSecret({
    ciphertext: row.encrypted_key,
    iv: row.iv,
    authTag: row.auth_tag,
  })
  if (!opened) {
    return {
      key: null,
      reason: 'A key is saved in Settings but could not be decrypted — USER_API_KEYS_ENCRYPTION_SECRET here is probably not the one it was sealed with.',
    }
  }
  return { key: opened }
}

export async function resolveAnthropicKey(
  admin: SupabaseClient | null,
): Promise<ResolveKeyResult> {
  const fromEnv = envKey()
  if (fromEnv) return { ok: true, key: fromEnv, source: 'env' }

  let settingsReason = 'Supabase credentials are not set here, so Settings could not be checked.'
  if (admin) {
    const fromSettings = await settingsKey(admin)
    if (fromSettings.key !== null) return { ok: true, key: fromSettings.key, source: 'settings' }
    settingsReason = fromSettings.reason
  }

  return {
    ok: false,
    message: [
      'No Anthropic API key found, so the review cannot run.',
      '',
      'Looked in two places, the same order the app uses:',
      `  1. Settings → API keys — ${settingsReason}`,
      '  2. ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in .env.local — not set.',
      '',
      'The quickest fix is a line in .env.local at the repo root:',
      '  ANTHROPIC_API_KEY=sk-ant-…',
    ].join('\n'),
  }
}
