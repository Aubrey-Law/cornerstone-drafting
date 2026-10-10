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
  /** Sanitized firm-wide signature appended only to opted-in manual sends. */
  emailSignatureHtml: string
  emailSignatureDefault: boolean
  /** Calendar Plan view workload target for one working day. */
  calendarDailyTargetMinutes: number
  /** Canonical work graph and ADHD-focused home page. */
  commandCenterV2Enabled: boolean
  /** Start of the current parallel-run window, or null while disabled. */
  commandCenterV2EnabledAt: string | null
  /** Final cutover after ten business days of passing parallel evidence. */
  commandCenterCutoverAt: string | null
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
  email_signature_html: string | null
  email_signature_default: boolean | null
  calendar_daily_target_minutes: number | null
  command_center_v2_enabled: boolean | null
  command_center_v2_enabled_at: string | null
  command_center_cutover_at: string | null
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
    emailSignatureHtml: '',
    emailSignatureDefault: true,
    calendarDailyTargetMinutes: 360,
    // Command Center is the Today home. Legacy Today remains available only
    // through emergency rollback in Settings → Command center.
    commandCenterV2Enabled: true,
    commandCenterV2EnabledAt: null,
    commandCenterCutoverAt: null,
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
          emailSignatureHtml: row.email_signature_html ?? base.emailSignatureHtml,
          emailSignatureDefault: row.email_signature_default ?? base.emailSignatureDefault,
          calendarDailyTargetMinutes: row.calendar_daily_target_minutes ?? base.calendarDailyTargetMinutes,
          commandCenterV2Enabled: row.command_center_v2_enabled ?? base.commandCenterV2Enabled,
          commandCenterV2EnabledAt: row.command_center_v2_enabled_at ?? null,
          commandCenterCutoverAt: row.command_center_cutover_at ?? null,
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
