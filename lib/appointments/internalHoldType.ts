import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

const INTERNAL_HOLD_TYPE_KEY = 'task_block'

/**
 * Internal focus blocks share one non-public appointment type. Keeping them in
 * `appointments` makes them participate in the same overlap constraint as
 * client meetings while the `raw.source` field preserves their origin.
 */
export async function getOrCreateInternalHoldType(admin: SupabaseClient): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from('appointment_types')
    .select('id, key')
    .eq('key', INTERNAL_HOLD_TYPE_KEY)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.id) return existing.id as string

  const insert = await admin.from('appointment_types').insert({
    key: INTERNAL_HOLD_TYPE_KEY,
    slug: 'task-block',
    label: 'Planning hold',
    description: 'Internal planning hold created from tasks or a committed daily plan.',
    duration_minutes: 30,
    location_type: 'phone',
    location_types: ['phone'],
    active: false,
    public: false,
    sort: 999,
  } as const)

  if (insert.error && insert.error.code !== '23505') throw insert.error
  const refreshed = await admin
    .from('appointment_types')
    .select('id, key')
    .eq('key', INTERNAL_HOLD_TYPE_KEY)
    .maybeSingle()
  if (refreshed.error) throw refreshed.error
  if (refreshed.data?.id) return refreshed.data.id as string
  throw insert.error ?? new Error('Unable to initialize the internal hold appointment type')
}
