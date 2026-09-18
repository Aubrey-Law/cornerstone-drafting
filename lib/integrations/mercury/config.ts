import 'server-only'
import { IntegrationError } from '@/lib/integrations/errors'

const DEFAULT_BASE_URL = 'https://api.mercury.com/api/v1'
const ALLOWED_HOSTS = new Set(['api.mercury.com', 'api-sandbox.mercury.com'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function baseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return DEFAULT_BASE_URL
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (!ALLOWED_HOSTS.has(url.hostname) || url.port) return null
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * The accounts that can legitimately receive client money.
 *
 * Deliberately not defaulted. With this unset every deposit classifies as
 * `wrong_account` and the card says so, which is a legible failure; guessing an
 * account would instead produce a confident, wrong worklist.
 */
function incomeAccountIds(value: string | undefined): string[] {
  const ids = (value ?? '').split(',').map(id => id.trim()).filter(Boolean)
  return ids.every(id => UUID.test(id)) ? ids : []
}

function readConfig() {
  return {
    token: process.env.MERCURY_API_TOKEN?.trim() || null,
    baseUrl: baseUrl(process.env.MERCURY_API_BASE_URL),
    incomeAccountIds: incomeAccountIds(process.env.MERCURY_INCOME_ACCOUNT_IDS),
  }
}

/** Server-only credentials. Never serialize this object into UI, logs, or errors. */
export function getMercuryConfig() {
  const { token, baseUrl: url, incomeAccountIds: accounts } = readConfig()
  if (!token || !url) {
    throw new IntegrationError({
      provider: 'mercury', kind: 'attention', code: 'configuration_required',
      safeMessage: 'Configure the Mercury API token before reading bank activity.', retryAfterMs: null,
    })
  }
  return { token, baseUrl: url, incomeAccountIds: accounts }
}

/** The only configuration shape safe to return to browser consumers. */
export function getMercuryConfigStatus() {
  const config = readConfig()
  return {
    tokenConfigured: config.token !== null,
    baseUrlValid: config.baseUrl !== null,
    incomeAccountsConfigured: config.incomeAccountIds.length > 0,
    sandbox: config.baseUrl?.includes('api-sandbox.') === true,
  }
}
