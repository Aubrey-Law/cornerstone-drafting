export interface TelnyxInboundRouteConfig {
  agentSipUri: string
  fallbackDestination: string
  ringTimeoutSeconds: number
}

const DEFAULT_RING_TIMEOUT_SECONDS = 25
const MIN_RING_TIMEOUT_SECONDS = 5
const MAX_RING_TIMEOUT_SECONDS = 600

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function telnyxInboundRouteConfig(): TelnyxInboundRouteConfig | null {
  const agentSipUri = process.env.TELNYX_INBOUND_AGENT_SIP_URI?.trim()
  const fallbackDestination = process.env.TELNYX_INBOUND_FALLBACK_DESTINATION?.trim()
  if (!agentSipUri || !fallbackDestination) return null
  if (!/^sip:[^\s]+@[^\s]+$/i.test(agentSipUri)) return null
  if (!/^\+[1-9]\d{7,14}$/.test(fallbackDestination)) return null

  const parsedTimeout = Number.parseInt(process.env.TELNYX_INBOUND_RING_TIMEOUT ?? '', 10)
  const ringTimeoutSeconds = Number.isFinite(parsedTimeout)
    ? Math.min(MAX_RING_TIMEOUT_SECONDS, Math.max(MIN_RING_TIMEOUT_SECONDS, parsedTimeout))
    : DEFAULT_RING_TIMEOUT_SECONDS

  return { agentSipUri, fallbackDestination, ringTimeoutSeconds }
}

export function buildTelnyxInboundTexml(config: TelnyxInboundRouteConfig | null): string {
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
  if (!config) return `${declaration}<Response><Hangup/></Response>`
  return declaration +
    `<Response><Dial answerOnBridge="true" sequential="true" timeout="${config.ringTimeoutSeconds}">` +
    `<Sip>${escapeXml(config.agentSipUri)}</Sip>` +
    `<Number>${escapeXml(config.fallbackDestination)}</Number>` +
    '</Dial></Response>'
}
