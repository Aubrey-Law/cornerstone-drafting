import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  EMAIL_CATEGORIES,
  normalizeEmailProvider,
  type EmailCategory,
  type EmailMode,
  type EmailProvider,
} from './categories'

const CACHE_MS = 30_000

interface CategorySettings {
  mode: EmailMode
  provider: EmailProvider
}

let cache: { at: number; settings: Record<EmailCategory, CategorySettings> } | null = null

/**
 * Categories that default to the firm's own mailbox rather than Resend.
 *
 * A manual one-off is a letter from the attorney, so it should come from — and
 * thread in — their own Sent Mail. Everything automated stays on Resend, where
 * bulk deliverability and bounce handling are the vendor's problem.
 */
const GMAIL_DEFAULT_CATEGORIES = new Set<EmailCategory>(['manual'])

export function envEmailsHardKilled(): boolean {
  const raw = process.env.EMAILS_ENABLED
  if (raw === undefined || raw === '') return false
  return raw === 'false' || raw === '0' || raw.toLowerCase() === 'off'
}

export function getTestInbox(): string {
  return process.env.EMAIL_TEST_INBOX || 'scott@aubreylegal.com'
}

export function getAllowlist(): string[] {
  const raw = process.env.EMAIL_ALLOWLIST
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isAllowed(toAddr: string): boolean {
  const allow = getAllowlist()
  if (allow.length === 0) return true
  const lower = toAddr.toLowerCase()
  return allow.some(entry => (entry.includes('@') ? entry === lower : lower.endsWith('@' + entry)))
}

function defaults(): Record<EmailCategory, CategorySettings> {
  return Object.fromEntries(
    EMAIL_CATEGORIES.map(c => [
      c,
      {
        mode: c === 'manual' ? ('on' as EmailMode) : ('on' as EmailMode),
        provider: (GMAIL_DEFAULT_CATEGORIES.has(c) ? 'gmail' : 'resend') as EmailProvider,
      },
    ]),
  ) as Record<EmailCategory, CategorySettings>
}

export async function getAllSettings(force = false): Promise<Record<EmailCategory, CategorySettings>> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.settings

  const settings = defaults()
  try {
    const { data, error } = await getAdminClient()
      .from('email_settings')
      .select('category, mode, provider')
    if (!error && data) {
      for (const row of data as { category: string; mode: EmailMode; provider: string | null }[]) {
        if ((EMAIL_CATEGORIES as readonly string[]).includes(row.category)) {
          settings[row.category as EmailCategory] = {
            mode: row.mode,
            provider: normalizeEmailProvider(row.provider),
          }
        }
      }
    }
  } catch {
    // DB unavailable — fall back to defaults
  }

  cache = { at: Date.now(), settings }
  return settings
}

export async function getMode(category: EmailCategory): Promise<EmailMode> {
  const all = await getAllSettings()
  return all[category].mode
}

export async function getProvider(category: EmailCategory): Promise<EmailProvider> {
  const all = await getAllSettings()
  return all[category].provider
}

export function clearSettingsCache() {
  cache = null
}
