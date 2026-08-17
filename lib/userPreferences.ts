import type { ApiKeyProvider } from '@/lib/userApiKeys'
import {
  ATTORNEY_PRESET_DECISION_FIELDS,
  ATTORNEY_PRESET_FIELDS,
  ATTORNEY_PRESET_SUPPORTED_VERSIONS,
  type AttorneyDesignPreset,
} from '@/lib/designSheet/fastEntryWorkflow'

export type DraftingDesignView = 'guided' | 'express'

/** LLM vendors supported for staff model preferences (matches API key providers). */
export type LlmProvider = ApiKeyProvider

export const LLM_PROVIDERS: LlmProvider[] = ['anthropic', 'openai', 'gemini']

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
}

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'anthropic'

/** Preferred Anthropic model id for assistant / redline / import. */
export type PreferredAnthropicModel =
  | 'claude-opus-4-8'
  | 'claude-sonnet-5'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-5'
  | 'claude-haiku-4-5'
  | string

export const ANTHROPIC_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (default)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

export const OPENAI_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'o3', label: 'o3 (reasoning)' },
]

export const GEMINI_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (default)' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
]

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

/** Retired model ids still stored in user preferences → current API ids. */
const DEPRECATED_ANTHROPIC_MODELS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-opus-4-20250514': 'claude-opus-4-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
}

export function normalizeAnthropicModel(modelId: string): string {
  const trimmed = modelId.trim()
  return DEPRECATED_ANTHROPIC_MODELS[trimmed] ?? trimmed
}

export function modelOptionsForProvider(provider: LlmProvider): Array<{ id: string; label: string }> {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_MODEL_OPTIONS
    case 'openai':
      return OPENAI_MODEL_OPTIONS
    case 'gemini':
      return GEMINI_MODEL_OPTIONS
  }
}

export function defaultModelForProvider(provider: LlmProvider): string {
  switch (provider) {
    case 'anthropic':
      return DEFAULT_ANTHROPIC_MODEL
    case 'openai':
      return DEFAULT_OPENAI_MODEL
    case 'gemini':
      return DEFAULT_GEMINI_MODEL
  }
}

export interface DraftingUserPreferences {
  designView?: DraftingDesignView
  /** Opts into the in-progress single-page design-sheet route. */
  singlePageDesignSheet?: boolean
  /** Hide decisions and sections that do not apply to the selected plan. */
  hideUnusedDesignDecisions?: boolean
  /** Show the live clause preview beside the single-page design sheet. */
  clausePreviewOpen?: boolean
  /** Hide the design sheet's section index so the form gets the full width. */
  designNavCollapsed?: boolean
  /** Hide the guided vs express tooltip after first dismissal. */
  designViewHintDismissed?: boolean
  /** Explicitly applied, versioned defaults limited to safe structural fields. */
  attorneyPreset?: AttorneyDesignPreset
}

export interface ModelsUserPreferences {
  /** Default vendor for assistant, redline, tabular review, and import. */
  defaultProvider?: LlmProvider
  anthropicModel?: PreferredAnthropicModel
  openaiModel?: string
  geminiModel?: string
}

export interface UserPreferences {
  drafting?: DraftingUserPreferences
  models?: ModelsUserPreferences
}

function parseLlmProvider(value: unknown): LlmProvider | undefined {
  if (value === 'anthropic' || value === 'openai' || value === 'gemini') return value
  return undefined
}

function parseOptionalModelId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseModels(raw: unknown): ModelsUserPreferences | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const models = raw as ModelsUserPreferences
  const result: ModelsUserPreferences = {}

  const defaultProvider = parseLlmProvider(models.defaultProvider)
  if (defaultProvider) result.defaultProvider = defaultProvider

  const anthropicModel = parseOptionalModelId(models.anthropicModel)
  if (anthropicModel) result.anthropicModel = anthropicModel

  const openaiModel = parseOptionalModelId(models.openaiModel)
  if (openaiModel) result.openaiModel = openaiModel

  const geminiModel = parseOptionalModelId(models.geminiModel)
  if (geminiModel) result.geminiModel = geminiModel

  return Object.keys(result).length > 0 ? result : undefined
}

function parseAttorneyPreset(raw: unknown): AttorneyDesignPreset | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const candidate = raw as { version?: unknown; fields?: unknown; decisions?: unknown }
  // Every supported version is read, not just the current one. A stored v1 preset
  // predates the decisions map but its column fields are still the attorney's
  // standards; rejecting it here would silently retire them, and the preset is
  // only rewritten when they next press save.
  if (!ATTORNEY_PRESET_SUPPORTED_VERSIONS.includes(candidate.version as 1 | 2)) return undefined
  if (candidate.fields == null || typeof candidate.fields !== 'object' || Array.isArray(candidate.fields)) return undefined

  const source = candidate.fields as Record<string, unknown>
  const fields: Record<string, unknown> = {}
  for (const field of ATTORNEY_PRESET_FIELDS) {
    if (source[field] !== undefined) fields[field] = source[field]
  }

  const version = candidate.version as AttorneyDesignPreset['version']
  if (version === 1) {
    return { version, fields: fields as AttorneyDesignPreset['fields'] }
  }

  const decisionSource = candidate.decisions != null
    && typeof candidate.decisions === 'object'
    && !Array.isArray(candidate.decisions)
    ? candidate.decisions as Record<string, unknown>
    : {}
  const decisions: Record<string, unknown> = {}
  for (const field of ATTORNEY_PRESET_DECISION_FIELDS) {
    if (decisionSource[field] !== undefined) decisions[field] = decisionSource[field]
  }

  return {
    version,
    fields: fields as AttorneyDesignPreset['fields'],
    decisions: decisions as AttorneyDesignPreset['decisions'],
  }
}

export function parseUserPreferences(raw: unknown): UserPreferences {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as UserPreferences
  const drafting = obj.drafting
  const designView = drafting?.designView
  return {
    drafting:
      drafting == null || typeof drafting !== 'object'
        ? undefined
        : {
            designView: designView === 'guided' || designView === 'express' ? designView : undefined,
            singlePageDesignSheet: drafting.singlePageDesignSheet === true,
            hideUnusedDesignDecisions: drafting.hideUnusedDesignDecisions !== false,
            clausePreviewOpen: drafting.clausePreviewOpen !== false,
            designNavCollapsed: drafting.designNavCollapsed === true,
            designViewHintDismissed: drafting.designViewHintDismissed === true,
            attorneyPreset: parseAttorneyPreset(drafting.attorneyPreset),
          },
    models: parseModels(obj.models),
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

export function resolveSinglePageDesignSheet(prefs?: UserPreferences | null): boolean {
  return prefs?.drafting?.singlePageDesignSheet ?? false
}

export function resolveHideUnusedDesignDecisions(prefs?: UserPreferences | null): boolean {
  return prefs?.drafting?.hideUnusedDesignDecisions ?? true
}

export function resolveClausePreviewOpen(prefs?: UserPreferences | null): boolean {
  return prefs?.drafting?.clausePreviewOpen ?? true
}

/** The section index starts visible; collapsing it is an explicit opt-in. */
export function resolveDesignNavCollapsed(prefs?: UserPreferences | null): boolean {
  return prefs?.drafting?.designNavCollapsed ?? false
}

export function resolveLlmProvider(prefs?: UserPreferences | null): LlmProvider {
  return prefs?.models?.defaultProvider ?? DEFAULT_LLM_PROVIDER
}

export function resolveAnthropicModel(prefs?: UserPreferences | null): string {
  const id = prefs?.models?.anthropicModel?.trim()
  return normalizeAnthropicModel(id || DEFAULT_ANTHROPIC_MODEL)
}

export function resolveOpenAiModel(prefs?: UserPreferences | null): string {
  const id = prefs?.models?.openaiModel?.trim()
  return id || DEFAULT_OPENAI_MODEL
}

export function resolveGeminiModel(prefs?: UserPreferences | null): string {
  const id = prefs?.models?.geminiModel?.trim()
  return id || DEFAULT_GEMINI_MODEL
}

export function resolveModelForProvider(
  provider: LlmProvider,
  prefs?: UserPreferences | null,
): string {
  switch (provider) {
    case 'anthropic':
      return resolveAnthropicModel(prefs)
    case 'openai':
      return resolveOpenAiModel(prefs)
    case 'gemini':
      return resolveGeminiModel(prefs)
  }
}

/** Active default provider + model id (for Phase B LLM routing). */
export function resolveActiveLlmPreference(prefs?: UserPreferences | null): {
  provider: LlmProvider
  model: string
} {
  const provider = resolveLlmProvider(prefs)
  return { provider, model: resolveModelForProvider(provider, prefs) }
}

export const DESIGN_VIEW_STORAGE_KEY = 'drafting-design-view'

export function resolveDesignView(args: {
  urlView: string | null
  storedLocal: string | null
  userPreference?: DraftingDesignView
  designComplete: boolean
  hasIntake?: boolean
}): DraftingDesignView {
  if (args.urlView === 'guided' || args.urlView === 'express') return args.urlView
  if (args.userPreference === 'guided' || args.userPreference === 'express') return args.userPreference
  if (args.storedLocal === 'guided' || args.storedLocal === 'express') return args.storedLocal
  // Intake-backed and completed matters benefit from unresolved-first fast entry.
  return args.designComplete || args.hasIntake ? 'express' : 'guided'
}
