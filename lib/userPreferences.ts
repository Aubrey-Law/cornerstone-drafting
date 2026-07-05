export type DraftingDesignView = 'guided' | 'express'

export interface DraftingUserPreferences {
  designView?: DraftingDesignView
  /** Hide the guided vs express tooltip after first dismissal. */
  designViewHintDismissed?: boolean
}

export interface UserPreferences {
  drafting?: DraftingUserPreferences
}

export function parseUserPreferences(raw: unknown): UserPreferences {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const drafting = (raw as UserPreferences).drafting
  if (drafting == null || typeof drafting !== 'object') return {}
  const designView = drafting.designView
  return {
    drafting: {
      designView: designView === 'guided' || designView === 'express' ? designView : undefined,
      designViewHintDismissed: drafting.designViewHintDismissed === true,
    },
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
  }
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
