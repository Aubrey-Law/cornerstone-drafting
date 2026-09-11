import type { DesignSheet } from '@/types/database'
import { prepareDesignSheetForSave } from './designSheetDraft'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'

export type DesignSheetConflict = {
  local: DesignSheet
  base: DesignSheet | null
  latest: DesignSheet | null
  error?: string
}
export type ConflictChoices = Record<string, 'local' | 'latest'>
export type DesignSheetDifference = { path: string; label: string; local: unknown; latest: unknown }
const metadata = new Set(['id', 'matter_id', 'client_intake_id', 'created_at', 'updated_at', 'version', 'overrides'])
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
const equal = (a: unknown, b: unknown): boolean => {
  if (a == null && b == null) return true
  if (record(a) && record(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => equal(a[k], b[k]))
  return JSON.stringify(a) === JSON.stringify(b)
}
export function compareDesignSheets(local: DesignSheet, latest: DesignSheet): DesignSheetDifference[] {
  const differences: DesignSheetDifference[] = []
  const walk = (a: Record<string, unknown>, b: Record<string, unknown>, prefix = '') => {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!prefix && metadata.has(key)) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (equal(a[key], b[key])) continue
      // Arrays are deliberate atomic choices: merging by index can assign a person's
      // instructions to a different beneficiary or fiduciary after a reorder.
      if (record(a[key]) && record(b[key])) walk(a[key], b[key], path)
      else differences.push({ path, label: path.replace(/^decisions\./, '').replaceAll('_', ' ').replaceAll('.', ' / '), local: a[key], latest: b[key] })
    }
  }
  walk(prepareDesignSheetForSave(local) as Record<string, unknown>, prepareDesignSheetForSave(latest) as Record<string, unknown>)
  return differences
}
export function resolveDesignSheetConflict(local: DesignSheet, latest: DesignSheet, choices: ConflictChoices): DesignSheet {
  const localPayload = prepareDesignSheetForSave(local) as Record<string, unknown>
  const latestPayload = prepareDesignSheetForSave(latest) as Record<string, unknown>
  const merged = JSON.parse(JSON.stringify(latestPayload)) as Record<string, unknown>
  for (const difference of compareDesignSheets(local, latest)) {
    if (!choices[difference.path]) throw new Error('Choose a version for every changed field.')
    if (choices[difference.path] !== 'local') continue
    const keys = difference.path.split('.')
    let target = merged
    for (const key of keys.slice(0, -1)) {
      if (!record(target[key])) target[key] = {}
      target = target[key] as Record<string, unknown>
    }
    // Null is explicit clearing in the persistence contract; omitted keys would
    // be merged back from the current server row by the PATCH route.
    target[keys[keys.length - 1]] = difference.local ?? null
  }
  // Override flags protect attorney-selected values from subsequent intake resync.
  // Match metadata to the chosen field value, without exposing metadata as choices.
  // Decisions-backed intake fields use the same unqualified override keys as columns.
  const overrides = { ...(latest.overrides ?? {}) }
  const fieldValue = (payload: Record<string, unknown>, field: string) => field in payload
    ? payload[field]
    : record(payload.decisions) ? payload.decisions[field] : undefined
  for (const field of new Set([...Object.keys(local.overrides ?? {}), ...Object.keys(overrides)])) {
    const value = fieldValue(merged, field)
    if (equal(value, fieldValue(latestPayload, field))) continue
    const localOverride = local.overrides?.[field]
    if (localOverride) overrides[field] = localOverride
    else if (equal(value, fieldValue(localPayload, field))) delete overrides[field]
    // A nested field assembled from both sources retains an available protection
    // flag: a later intake sync must not silently replace this reviewed combination.
  }
  merged.overrides = Object.keys(overrides).length ? overrides : null
  return inflateDesignSheetRow({ ...merged, id: latest.id, matter_id: latest.matter_id, updated_at: latest.updated_at })!
}
