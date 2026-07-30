export interface TelnyxInboundRouteConfig {
  agentSipUri: string
  fallbackDestination: string
  ringTimeoutSeconds: number
}

const DEFAULT_RING_TIMEOUT_SECONDS = 25
const MIN_RING_TIMEOUT_SECONDS = 5
const MAX_RING_TIMEOUT_SECONDS = 120
const GENERATED_CREDENTIAL_SIP_URI = /^sip:gencred[A-Za-z0-9]+@sip\.telnyx\.com$/i
const E164_DESTINATION = /^\+[1-9]\d{7,14}$/

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
  if (!agentSipUri || !fallbackDestination || telnyxInboundRoutingIssues().length > 0) return null

  const timeout = process.env.TELNYX_INBOUND_RING_TIMEOUT?.trim() ?? ''
  const parsedTimeout = /^\d+$/.test(timeout) ? Number(timeout) : Number.NaN
  const ringTimeoutSeconds = Number.isFinite(parsedTimeout)
    ? Math.min(MAX_RING_TIMEOUT_SECONDS, Math.max(MIN_RING_TIMEOUT_SECONDS, parsedTimeout))
    : DEFAULT_RING_TIMEOUT_SECONDS

  return { agentSipUri, fallbackDestination, ringTimeoutSeconds }
}

export function telnyxInboundRoutingIssues(): string[] {
  const agentSipUri = process.env.TELNYX_INBOUND_AGENT_SIP_URI?.trim()
  const fallbackDestination = process.env.TELNYX_INBOUND_FALLBACK_DESTINATION?.trim()
  const issues: string[] = []

  if (!agentSipUri) {
    issues.push('TELNYX_INBOUND_AGENT_SIP_URI')
  } else if (!GENERATED_CREDENTIAL_SIP_URI.test(agentSipUri)) {
    issues.push('TELNYX_INBOUND_AGENT_SIP_URI (expected sip:gencred...@sip.telnyx.com)')
  }

  if (!fallbackDestination) {
    issues.push('TELNYX_INBOUND_FALLBACK_DESTINATION')
  } else if (!E164_DESTINATION.test(fallbackDestination)) {
    issues.push('TELNYX_INBOUND_FALLBACK_DESTINATION (expected E.164)')
  }

  return issues
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
