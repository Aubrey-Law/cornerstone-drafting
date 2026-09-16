import 'server-only'
import { IntegrationError } from '@/lib/integrations/errors'

function webhookUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    if (process.env.NODE_ENV === 'production' && (url.hostname !== 'api.statular.com' || url.port)) return null
    return url.href
  } catch {
    return null
  }
}

function readConfig() {
  return {
    clientWebhookUrl: webhookUrl(process.env.STATULAR_CLIENT_WEBHOOK_URL),
    matterWebhookUrl: webhookUrl(process.env.STATULAR_MATTER_WEBHOOK_URL),
    generation: process.env.STATULAR_WEBHOOK_GENERATION?.trim() || null,
  }
}

/** Server-only credentials. Never serialize this object into UI, logs, or errors. */
export function getStatularConfig() {
  const { clientWebhookUrl, matterWebhookUrl, generation } = readConfig()
  if (!clientWebhookUrl || !matterWebhookUrl || !generation) {
    throw new IntegrationError({
      provider: 'statular', kind: 'attention', code: 'configuration_required',
      safeMessage: 'Configure both Statular webhooks and their generation before synchronization.', retryAfterMs: null,
    })
  }
  return { clientWebhookUrl, matterWebhookUrl, generation }
}

/** The only configuration shape safe to return to browser consumers. */
export function getStatularConfigStatus() {
  const config = readConfig()
  return {
    clientConfigured: config.clientWebhookUrl !== null,
    matterConfigured: config.matterWebhookUrl !== null,
    generationConfigured: config.generation !== null,
  }
}
