import { getAdminClient } from '@/lib/supabaseAdmin'

const SMS_OPT_IN_PATTERN = /^\s*(start|unstop|yes)\s*$/i

export function isSmsOptInMessage(body: string): boolean {
  return SMS_OPT_IN_PATTERN.test(body.trim())
}

/** Same 10-digit key as the SQL `normalize_us_phone()`. */
export function optOutPhoneKey(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, '') ?? ''
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

export async function recordSmsOptOut(fromNumber: string, sourceMessageId: string): Promise<void> {
  const phone = optOutPhoneKey(fromNumber)
  if (!phone) return
  const now = new Date().toISOString()
  const { error } = await getAdminClient()
    .from('sms_opt_outs')
    .upsert(
      { phone, opted_out_at: now, opted_in_at: null, source_message_id: sourceMessageId, updated_at: now },
      { onConflict: 'phone' },
    )
  if (error) throw new Error(`recordSmsOptOut: ${error.message}`)
}

export async function recordSmsOptIn(fromNumber: string): Promise<void> {
  const phone = optOutPhoneKey(fromNumber)
  if (!phone) return
  const now = new Date().toISOString()
  // Only an existing opt-out can be reversed; a stray "yes" is just a reply.
  const { error } = await getAdminClient()
    .from('sms_opt_outs')
    .update({ opted_in_at: now, updated_at: now })
    .eq('phone', phone)
  if (error) throw new Error(`recordSmsOptIn: ${error.message}`)
}

export async function isPhoneOptedOut(value: string): Promise<boolean> {
  const phone = optOutPhoneKey(value)
  if (!phone) return false
  const { data, error } = await getAdminClient()
    .from('sms_opt_outs')
    .select('opted_in_at')
    .eq('phone', phone)
    .maybeSingle()
  // Fail closed: if the list can't be read, don't text someone who may have said STOP.
  if (error) throw new Error(`isPhoneOptedOut: ${error.message}`)
  return Boolean(data) && !data?.opted_in_at
}
