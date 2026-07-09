import 'server-only'

export type ModelRole = 'assistant' | 'drafting' | 'light'

const DEFAULT_MODELS: Record<ModelRole, string> = {
  assistant: process.env.ANTHROPIC_MODEL_ASSISTANT ?? 'claude-sonnet-4-20250514',
  drafting: process.env.ANTHROPIC_MODEL_DRAFTING ?? 'claude-sonnet-4-20250514',
  light: process.env.ANTHROPIC_MODEL_LIGHT ?? 'claude-sonnet-4-20250514',
}

export async function resolveFirmModel(role: ModelRole): Promise<string> {
  return DEFAULT_MODELS[role]
}
