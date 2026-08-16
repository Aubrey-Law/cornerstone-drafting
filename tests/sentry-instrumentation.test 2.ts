import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureRequestError: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init: vi.fn(),
  replayIntegration: vi.fn(),
}))

describe('Sentry instrumentation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.invalid/1')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'test')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_RELEASE', 'test-release')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_REPLAY', '0')
  })

  it('initializes server monitoring through Next instrumentation and scrubs legal PII', async () => {
    const Sentry = await import('@sentry/nextjs')
    const instrumentation = await import('../instrumentation')

    await instrumentation.register()

    expect(Sentry.init).toHaveBeenCalledOnce()
    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0]
    expect(options).toMatchObject({
      dsn: 'https://public@example.invalid/1',
      environment: 'test',
      release: 'test-release',
      sendDefaultPii: false,
    })

    const event = {
      type: undefined,
      request: {
        cookies: { session: 'secret' },
        data: { clientName: 'Sensitive Client' },
        headers: { authorization: 'Bearer secret' },
        query_string: 'matter=secret',
        url: 'https://example.invalid/admin/matters/123',
      },
      user: { id: 'sensitive-user' },
    }
    const scrubbed = options?.beforeSend?.(event, {})

    expect(scrubbed).toEqual({
      type: undefined,
      request: { url: 'https://example.invalid/admin/matters/123' },
    })
  })

  it('forwards uncaught server request errors to Sentry', async () => {
    const Sentry = await import('@sentry/nextjs')
    const instrumentation = await import('../instrumentation')
    const error = Object.assign(new Error('request failed'), { digest: 'digest-123' })
    const request = { path: '/admin', method: 'GET', headers: {} }
    const context = {
      routerKind: 'App Router' as const,
      routePath: '/admin',
      routeType: 'render' as const,
      renderSource: 'server-rendering' as const,
      revalidateReason: undefined,
      renderType: 'dynamic' as const,
    }

    await instrumentation.onRequestError(error, request, context)

    expect(Sentry.captureRequestError).toHaveBeenCalledWith(error, request, context)
  })

  it('initializes browser monitoring before hydration and captures router transitions', async () => {
    const Sentry = await import('@sentry/nextjs')
    const clientInstrumentation = await import('../instrumentation-client')

    expect(Sentry.init).toHaveBeenCalledOnce()
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@example.invalid/1',
        environment: 'test',
        release: 'test-release',
        sendDefaultPii: false,
      }),
    )

    clientInstrumentation.onRouterTransitionStart('/admin/matters', 'push')
    expect(Sentry.captureRouterTransitionStart).toHaveBeenCalledWith('/admin/matters', 'push')
  })
})
