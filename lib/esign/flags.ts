import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * The firm-level e-sign switches, read per call so a cutover can be reversed
 * without a deploy. Kept in a module with no PDF dependencies: the lifecycle
 * registry asks "does the firm sign natively?" from routes that must not pull
 * the sealer into their bundle.
 */

/** Whether this firm signs through Cornerstone rather than the vendor. Fails closed. */
export async function esignNativeEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('esign_native_enabled')
    .eq('id', 1)
    .maybeSingle()
  return !error && data?.esign_native_enabled === true
}
