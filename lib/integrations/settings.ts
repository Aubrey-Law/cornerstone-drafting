import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'

type SettingsRow = GeneratedDatabase['public']['Tables']['integration_settings']['Row']
type SettingsInsert = GeneratedDatabase['public']['Tables']['integration_settings']['Insert']

function admin(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('Integration settings must be an object.')
  }
  return value as Record<string, unknown>
}

function validateKey(key: string): void {
  if (!key || key !== key.trim() || ['__proto__', 'constructor', 'prototype'].includes(key)) {
    throw new Error('Integration mapping keys must be non-empty stable keys.')
  }
}

const STATULAR_ESTATE_PLAN_KEYS = new Set([
  'individual_trust',
  'joint_trust',
  'separate_trust',
  'will_individual',
  'will_couple',
  'testamentary_trust_individual',
  'testamentary_trust_couple',
  'incapacity_individual',
  'incapacity_couple',
])

export function isValidStatularPackageKey(key: string): boolean {
  if (key === 'CP:college_prep') return true
  const separator = key.indexOf(':')
  if (separator < 0 || separator !== key.lastIndexOf(':')) return false
  const practiceArea = key.slice(0, separator)
  const planKey = key.slice(separator + 1)
  return (practiceArea === 'EP' || practiceArea === 'EP-LP')
    && STATULAR_ESTATE_PLAN_KEYS.has(planKey)
}

function providerId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Provider IDs must be non-empty strings.')
  return value.trim()
}

export function sanitizeProviderIdMap(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(requireObject(value)).map(([key, id]) => {
    validateKey(key)
    return [key, providerId(id)]
  }))
}

export function sanitizeDocIdMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(requireObject(value)).map(([key, id]) => {
    validateKey(key)
    if (!isValidStatularPackageKey(key)) {
      throw new Error('Statular document mapping keys must be exact package keys.')
    }
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error('Statular document IDs must be a positive integer.')
    }
    return [key, id]
  }))
}

function readableDocIdMap(value: unknown): Record<string, number> {
  let entries: Array<[string, unknown]>
  try {
    entries = Object.entries(requireObject(value))
  } catch {
    return {}
  }
  const accepted: Array<[string, number]> = []
  for (const [key, id] of entries) {
    if (isValidStatularPackageKey(key)
      && typeof id === 'number'
      && Number.isSafeInteger(id)
      && id > 0) {
      accepted.push([key, id])
    }
  }
  return Object.fromEntries(accepted)
}

export function sanitizeProviderIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Provider IDs must be an array.')
  return value.map(providerId)
}

export interface IntegrationSettings {
  lawmaticsAppointmentSyncEnabled: boolean
  lawmaticsEventTypeIdMap: Record<string, string>
  lawmaticsLocationIdMap: Record<string, string>
  lawmaticsUserIds: string[]
  lawmaticsLastCheckedAt: string | null
  lawmaticsLastCheckError: string | null
  statularSyncEnabled: boolean
  statularDocIdMap: Record<string, number>
  statularDrafterId: string | null
}

function fromRow(row: SettingsRow | null): IntegrationSettings {
  return {
    lawmaticsAppointmentSyncEnabled: row?.lawmatics_appointment_sync_enabled === true,
    lawmaticsEventTypeIdMap: sanitizeProviderIdMap(row?.lawmatics_event_type_id_map ?? {}),
    lawmaticsLocationIdMap: sanitizeProviderIdMap(row?.lawmatics_location_id_map ?? {}),
    lawmaticsUserIds: sanitizeProviderIds(row?.lawmatics_user_ids ?? []),
    lawmaticsLastCheckedAt: row?.lawmatics_last_checked_at ?? null,
    lawmaticsLastCheckError: row?.lawmatics_last_check_error ? 'Lawmatics connection check failed.' : null,
    statularSyncEnabled: row?.statular_sync_enabled === true,
    statularDocIdMap: readableDocIdMap(row?.statular_doc_id_map ?? {}),
    statularDrafterId: row?.statular_drafter_id == null ? null : providerId(row.statular_drafter_id),
  }
}

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  const { data, error } = await admin().from('integration_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error('Unable to read integration settings.')
  return fromRow(data)
}

export async function updateIntegrationSettings(input: unknown, actorId: string | null): Promise<void> {
  const fields = requireObject(input)
  const allowed = new Set([
    'lawmaticsAppointmentSyncEnabled', 'lawmaticsEventTypeIdMap', 'lawmaticsLocationIdMap',
    'lawmaticsUserIds', 'statularSyncEnabled', 'statularDocIdMap', 'statularDrafterId',
  ])
  if (Object.keys(fields).some(key => !allowed.has(key))) throw new Error('Unknown integration setting.')
  const patch: SettingsInsert = { id: 1, updated_by: actorId, updated_at: new Date().toISOString() }
  for (const [inputKey, column] of [
    ['lawmaticsAppointmentSyncEnabled', 'lawmatics_appointment_sync_enabled'],
    ['statularSyncEnabled', 'statular_sync_enabled'],
  ] as const) {
    if (inputKey in fields) {
      if (typeof fields[inputKey] !== 'boolean') throw new Error('Integration enablement must be boolean.')
      patch[column] = fields[inputKey]
    }
  }
  if ('lawmaticsEventTypeIdMap' in fields) patch.lawmatics_event_type_id_map = sanitizeProviderIdMap(fields.lawmaticsEventTypeIdMap)
  if ('lawmaticsLocationIdMap' in fields) patch.lawmatics_location_id_map = sanitizeProviderIdMap(fields.lawmaticsLocationIdMap)
  if ('lawmaticsUserIds' in fields) patch.lawmatics_user_ids = sanitizeProviderIds(fields.lawmaticsUserIds)
  if ('statularDocIdMap' in fields) patch.statular_doc_id_map = sanitizeDocIdMap(fields.statularDocIdMap)
  if ('statularDrafterId' in fields) patch.statular_drafter_id = fields.statularDrafterId === null ? null : providerId(fields.statularDrafterId)

  const { error } = await admin().from('integration_settings').upsert(patch, { onConflict: 'id' })
  if (error) throw new Error('Unable to save integration settings.')
}
