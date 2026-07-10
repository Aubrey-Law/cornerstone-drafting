import 'server-only'

import { DEFAULT_ANTHROPIC_MODEL, normalizeAnthropicModel } from '@/lib/userPreferences'

export type ModelRole = 'assistant' | 'drafting' | 'light'

function firmModelFromEnv(envValue: string | undefined): string {
  return normalizeAnthropicModel(envValue?.trim() || DEFAULT_ANTHROPIC_MODEL)
}

const DEFAULT_MODELS: Record<ModelRole, string> = {
  assistant: firmModelFromEnv(process.env.ANTHROPIC_MODEL_ASSISTANT),
  drafting: firmModelFromEnv(process.env.ANTHROPIC_MODEL_DRAFTING),
  light: firmModelFromEnv(process.env.ANTHROPIC_MODEL_LIGHT),
}

export async function resolveFirmModel(role: ModelRole): Promise<string> {
  return DEFAULT_MODELS[role]
}
