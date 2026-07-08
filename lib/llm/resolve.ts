import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveApiKey } from '@/lib/userApiKeys'
import {
  LLM_PROVIDER_LABELS,
  parseUserPreferences,
  resolveActiveLlmPreference,
  type LlmProvider,
} from '@/lib/userPreferences'
import type { LlmConfig } from '@/lib/llm/types'

export function llmKeyMissingMessage(provider: LlmProvider): string {
  const label = LLM_PROVIDER_LABELS[provider]
  const envVar =
    provider === 'anthropic'
      ? 'ANTHROPIC_API_KEY'
      : provider === 'openai'
        ? 'OPENAI_API_KEY'
        : 'GEMINI_API_KEY'
  return `No ${label} API key configured. Add one in Settings → API Keys or set ${envVar}.`
}

export async function resolveLlmConfig(
  admin: SupabaseClient,
  userId: string | null | undefined,
): Promise<{ ok: true; config: LlmConfig } | { ok: false; error: string; provider: LlmProvider }> {
  let preferences = {}
  if (userId) {
    const { data: profile } = await admin
      .from('users')
      .select('preferences')
      .eq('id', userId)
      .maybeSingle()
    preferences = parseUserPreferences(profile?.preferences)
  } else {
    preferences = {}
  }

  const { provider, model } = resolveActiveLlmPreference(preferences)
  const resolved = await resolveApiKey(admin, userId, provider)
  if (!resolved.key) {
    return { ok: false, error: llmKeyMissingMessage(provider), provider }
  }

  return {
    ok: true,
    config: {
      provider,
      model,
      apiKey: resolved.key,
      keySource: resolved.source,
    },
  }
}
