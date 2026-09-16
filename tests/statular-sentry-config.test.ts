import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the external SDK setup, retaining the application's actual configuration
// callback and its URL predicates. No telemetry or provider request is sent.
vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  nativeNodeFetchIntegration: vi.fn(() => ({ name: 'NodeFetch' })),
  httpIntegration: vi.fn(() => ({ name: 'Http' })),
}))

const clientUrl = 'https://api.statular.com/webhooks/v1/stat_whk_syntheticClient'
const matterUrl = 'https://api.statular.com/webhooks/v1/stat_whk_syntheticMatter'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.invalid/1')
  vi.stubEnv('STATULAR_CLIENT_WEBHOOK_URL', clientUrl)
  vi.stubEnv('STATULAR_MATTER_WEBHOOK_URL', matterUrl)
})

afterEach(() => vi.unstubAllEnvs())

async function configuredIntegrations() {
  const sdk = await import('@sentry/nextjs')
  await import('@/lib/sentry/server')
  const configure = vi.mocked(sdk.init).mock.calls[0]?.[0]?.integrations
  expect(configure).toBeTypeOf('function')
  if (typeof configure !== 'function') throw new Error('Missing Sentry integration configuration')
  const defaults = [{ name: 'NodeFetch' }, { name: 'Http' }, { name: 'Console' }]
  const configured = configure(defaults)
  return { sdk, defaults, configured }
}

describe('Statular webhook telemetry exclusion', () => {
  it('replaces both default transports while preserving unrelated integrations', async () => {
    const { configured, defaults } = await configuredIntegrations()
    expect(configured.map(integration => integration.name)).toEqual(['Console', 'NodeFetch', 'Http'])
    expect(configured).toContain(defaults[2])
    expect(configured).not.toContain(defaults[0])
    expect(configured).not.toContain(defaults[1])
    expect(JSON.stringify(configured)).not.toContain('stat_whk_')
  })

  it('preserves Next.js ownership of incoming request spans when replacing HTTP instrumentation', async () => {
    const { sdk } = await configuredIntegrations()
    expect(vi.mocked(sdk.httpIntegration).mock.calls[0]?.[0]?.disableIncomingRequestSpans).toBe(true)
  })

  it.each(['fetch', 'http'] as const)('excludes exact configured webhook URLs from %s breadcrumbs and spans', async transport => {
    const { sdk } = await configuredIntegrations()
    const ignore = transport === 'fetch'
      ? vi.mocked(sdk.nativeNodeFetchIntegration).mock.calls[0]?.[0]?.ignoreOutgoingRequests
      : vi.mocked(sdk.httpIntegration).mock.calls[0]?.[0]?.ignoreOutgoingRequests
    expect(ignore).toBeTypeOf('function')
    if (!ignore) throw new Error('Missing outgoing request exclusion')
    expect(ignore(clientUrl, {})).toBe(true)
    expect(ignore(matterUrl, {})).toBe(true)
    for (const url of [
      `${clientUrl}-different`, `${clientUrl}?other=1`, `${clientUrl}/extra`,
      'https://api.statular.com/', 'https://api.lawmatics.com/v1/prospects',
      'https://unrelated.invalid/webhooks/v1/stat_whk_syntheticClient', '',
    ]) expect(ignore(url, {})).toBe(false)
  })

  it('matches the canonical URL used by transport even when configured with whitespace or default port', async () => {
    vi.stubEnv('STATULAR_CLIENT_WEBHOOK_URL', `  ${clientUrl.replace('api.statular.com', 'API.STATULAR.COM:443')}  `)
    const { sdk } = await configuredIntegrations()
    const ignore = vi.mocked(sdk.nativeNodeFetchIntegration).mock.calls[0]?.[0]?.ignoreOutgoingRequests
    expect(ignore?.(clientUrl)).toBe(true)
  })

  it('handles missing or malformed secret configuration without suppressing unrelated requests', async () => {
    vi.stubEnv('STATULAR_CLIENT_WEBHOOK_URL', '')
    vi.stubEnv('STATULAR_MATTER_WEBHOOK_URL', 'not-a-url')
    const { sdk } = await configuredIntegrations()
    const ignore = vi.mocked(sdk.nativeNodeFetchIntegration).mock.calls[0]?.[0]?.ignoreOutgoingRequests
    expect(ignore?.(clientUrl)).toBe(false)
    expect(ignore?.('')).toBe(false)
  })
})
