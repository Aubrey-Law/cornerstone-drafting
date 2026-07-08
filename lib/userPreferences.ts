export type DraftingDesignView = 'guided' | 'express'

/** Preferred Anthropic model id for assistant / redline / import. */
export type PreferredAnthropicModel =
  | 'claude-sonnet-4-20250514'
  | 'claude-opus-4-20250514'
  | 'claude-haiku-4-5-20251001'
  | string

export const ANTHROPIC_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (default)' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'

export interface DraftingUserPreferences {
  designView?: DraftingDesignView
  /** Hide the guided vs express tooltip after first dismissal. */
  designViewHintDismissed?: boolean
}

export interface ModelsUserPreferences {
  anthropicModel?: PreferredAnthropicModel
}

export interface UserPreferences {
  drafting?: DraftingUserPreferences
  models?: ModelsUserPreferences
}

export function parseUserPreferences(raw: unknown): UserPreferences {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as UserPreferences
  const drafting = obj.drafting
  const models = obj.models
  const designView = drafting?.designView
  const anthropicModel =
    typeof models?.anthropicModel === 'string' && models.anthropicModel.trim()
      ? models.anthropicModel.trim()
      : undefined
  return {
    drafting:
      drafting == null || typeof drafting !== 'object'
        ? undefined
        : {
            designView: designView === 'guided' || designView === 'express' ? designView : undefined,
            designViewHintDismissed: drafting.designViewHintDismissed === true,
          },
    models: anthropicModel ? { anthropicModel } : undefined,
  }
}

export function mergeUserPreferences(
  existing: UserPreferences,
  patch: Partial<UserPreferences>,
): UserPreferences {
  return {
    ...existing,
    drafting: {
      ...existing.drafting,
      ...patch.drafting,
    },
    models: {
      ...existing.models,
      ...patch.models,
    },
  }
}

export function resolveAnthropicModel(prefs?: UserPreferences | null): string {
  const id = prefs?.models?.anthropicModel?.trim()
  return id || DEFAULT_ANTHROPIC_MODEL
}

export const DESIGN_VIEW_STORAGE_KEY = 'drafting-design-view'

export function resolveDesignView(args: {
  urlView: string | null
  storedLocal: string | null
  userPreference?: DraftingDesignView
  designComplete: boolean
}): DraftingDesignView {
  if (args.urlView === 'guided' || args.urlView === 'express') return args.urlView
  if (args.userPreference === 'guided' || args.userPreference === 'express') return args.userPreference
  if (args.storedLocal === 'guided' || args.storedLocal === 'express') return args.storedLocal
  // Default new attorneys to guided until the sheet is complete once.
  return args.designComplete ? 'express' : 'guided'
}
