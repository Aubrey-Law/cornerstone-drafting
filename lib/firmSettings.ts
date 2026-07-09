import 'server-only'
import { getAdminClient } from './supabaseAdmin'
import { formatPhoneDisplay } from './phone'
import { buildFirmSignatureHtml, getFirmConfig, type FirmConfig } from './firmConfig'

export interface FullFirmSettings extends FirmConfig {
  street: string
  state: string
  zip: string
  website: string
  barNumber: string
  admitted: string
  specialization: string
  /** Global toggle: wrap stored-template emails with the firm header/footer. */
  emailLogoHeader: boolean
}

interface FirmSettingsRow {
  firm_name: string | null
  attorney_name: string | null
  attorney_short_name: string | null
  city: string | null
  email: string | null
  phone: string | null
  street: string | null
  state: string | null
  zip: string | null
  website: string | null
  bar_number: string | null
  admitted: string | null
  specialization: string | null
  email_logo_header: boolean | null
}

let cache: { value: FullFirmSettings; at: number } | null = null
const TTL_MS = 30_000

function defaults(): FullFirmSettings {
  const env = getFirmConfig()
  return {
    ...env,
    phone: formatPhoneDisplay(env.phone),
    street: '',
    state: 'MA',
    zip: '',
    website: '',
    barNumber: '',
    admitted: '',
    specialization: 'Estate Planning & Probate',
    emailLogoHeader: true,
  }
}

export async function loadFirmSettings(force = false): Promise<FullFirmSettings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  const env = getFirmConfig()
  const base = defaults()
  try {
    const { data } = await getAdminClient()
      .from('firm_settings' as never)
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    const row = (data ?? null) as FirmSettingsRow | null
    const merged: FullFirmSettings = row
      ? {
          attorneyName: row.attorney_name ?? env.attorneyName,
          attorneyShortName: row.attorney_short_name ?? env.attorneyShortName,
          firmName: row.firm_name ?? env.firmName,
          city: row.city ?? env.city,
          email: row.email ?? env.email,
          phone: formatPhoneDisplay(row.phone ?? env.phone),
          street: row.street ?? base.street,
          state: row.state ?? base.state,
          zip: row.zip ?? base.zip,
          website: row.website ?? base.website,
          barNumber: row.bar_number ?? base.barNumber,
          admitted: row.admitted ?? base.admitted,
          specialization: row.specialization ?? base.specialization,
          emailLogoHeader: row.email_logo_header ?? base.emailLogoHeader,
        }
      : base
    cache = { value: merged, at: Date.now() }
    return merged
  } catch {
    return base
  }
}

export function clearFirmSettingsCache(): void {
  cache = null
}

export async function getResendFromAsync(): Promise<string> {
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM
  const f = await loadFirmSettings()
  return `${f.attorneyShortName} <${f.email}>`
}

export async function firmEmailSignatureHtmlAsync(
  opts: { includeCity?: boolean; includePhone?: boolean } = {},
): Promise<string> {
  return buildFirmSignatureHtml(await loadFirmSettings(), opts)
}
