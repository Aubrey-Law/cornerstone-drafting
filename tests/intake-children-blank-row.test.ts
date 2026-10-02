import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { reconcileHouseholdChildren } from '@/lib/contacts/reconcileHouseholdChildren'

/** Any database access fails loudly, so a test passes only if none happens. */
function untouchableAdmin(): SupabaseClient<Database> {
  return new Proxy({}, {
    get() {
      throw new Error('database was touched')
    },
  }) as SupabaseClient<Database>
}

describe('saving the children section with an unfinished row', () => {
  it('ignores a blank row from "Add child" instead of failing the save', async () => {
    const blank = {
      id: 'tmp', first_name: '', middle_name: '', last_name: '', suffix: '',
      date_of_birth: '', pronouns: '', email: '', phone: '', same_address: false,
      parent: 'both', relationship: 'biological',
    }
    await expect(
      reconcileHouseholdChildren(untouchableAdmin(), 'intake-1', [blank]),
    ).resolves.toBeUndefined()
  })

  it('ignores a row that only has whitespace or a birth date', async () => {
    await expect(
      reconcileHouseholdChildren(untouchableAdmin(), 'intake-1', [
        { first_name: '  ', last_name: '' },
        { first_name: '', last_name: '', date_of_birth: '2015-04-01' },
      ]),
    ).resolves.toBeUndefined()
  })
})
