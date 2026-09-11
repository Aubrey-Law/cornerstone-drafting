import type { DesignSheet, DesignSheetUpdate } from '@/types/database'
import { buildDesignSheetPersistencePayload, stripDecisionOnlyTopLevelMirrors } from '@/lib/designSheetPersistence'
import type { DesignSheetConflict } from './designSheetConflict'

const DRAFT_PREFIX = 'cornerstone:design-sheet-draft:'

/** In-memory fallback when sessionStorage is unavailable (SSR / some test runners). */
const memoryDrafts = new Map<string, string>()

function storageGet(key: string): string | null {
  if (typeof window !== 'undefined') {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      // fall through
    }
  }
  return memoryDrafts.get(key) ?? null
}

function storageSet(key: string, value: string): void {
  memoryDrafts.set(key, value)
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // memory fallback already set
    }
  }
}

function storageRemove(key: string): void {
  memoryDrafts.delete(key)
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}

export type DesignSheetDraftRecord = {
  matterId: string
  /** Server updated_at the draft was based on (or last successful save). */
  baseUpdatedAt: string | null
  sheet: DesignSheet
  baseSheet?: DesignSheet | null
  conflict?: DesignSheetConflict | null
  savedAt: number
}

export function designSheetDraftStorageKey(matterId: string): string {
  return `${DRAFT_PREFIX}${matterId}`
}

export function readDesignSheetDraft(matterId: string): DesignSheetDraftRecord | null {
  try {
    const raw = storageGet(designSheetDraftStorageKey(matterId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DesignSheetDraftRecord
    if (!parsed?.sheet || parsed.matterId !== matterId) return null
    return parsed
  } catch {
    return null
  }
}

export function writeDesignSheetDraft(args: {
  matterId: string
  sheet: DesignSheet
  baseUpdatedAt: string | null
  baseSheet?: DesignSheet | null
  conflict?: DesignSheetConflict | null
}): void {
  try {
    const record: DesignSheetDraftRecord = {
      matterId: args.matterId,
      baseUpdatedAt: args.baseUpdatedAt,
      sheet: args.sheet,
      baseSheet: args.baseSheet,
      conflict: args.conflict,
      savedAt: Date.now(),
    }
    storageSet(designSheetDraftStorageKey(args.matterId), JSON.stringify(record))
  } catch {
    // ignore
  }
}

export function clearDesignSheetDraft(matterId: string): void {
  storageRemove(designSheetDraftStorageKey(matterId))
}

/** Prefer a session draft when it is at least as new as the server props stamp. */
export function resolveInitialDesignSheet(args: {
  matterId: string
  sheetProp: DesignSheet | null
  buildFromProps: () => DesignSheet
}): DesignSheet {
  const fromProps = args.buildFromProps()
  const draft = readDesignSheetDraft(args.matterId)
  if (!draft) return fromProps

  // A stale draft is recovery data, never disposable. The state hook pauses
  // saving and asks for explicit comparison when its base differs from props.
  return draft.sheet
}

/**
 * Build the exact row patch we intend to persist. Prefer this over sending the live
 * UI sheet object, which may still carry stale inflated decision mirrors.
 */
export function prepareDesignSheetForSave(sheet: DesignSheet): DesignSheetUpdate {
  const cleaned = stripDecisionOnlyTopLevelMirrors(
    sheet as unknown as Record<string, unknown>,
  ) as unknown as DesignSheet
  const payload = buildDesignSheetPersistencePayload(cleaned)
  return {
    ...payload,
    // Keep identity fields the API merge expects.
    id: sheet.id,
    matter_id: sheet.matter_id,
  } as DesignSheetUpdate
}
