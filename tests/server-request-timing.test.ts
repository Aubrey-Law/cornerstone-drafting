import { afterEach, describe, expect, it, vi } from 'vitest'
import { profileServerRequest } from '@/lib/performance/serverRequestTiming'

afterEach(() => vi.restoreAllMocks())

describe('server request timing', () => {
  it('returns a browser-safe Server-Timing value and logs only fixed labels when slow', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const privateResult = { client: 'Private Client' }

    const profiled = await profileServerRequest('proxy', async measure => {
      await measure('auth', () => { now = 900; return 'private-user-id' })
      return measure('role', () => { now = 1_700; return privateResult })
    })

    expect(profiled.value).toBe(privateResult)
    expect(profiled.serverTiming).toBe('proxy;dur=1700, auth;dur=900, role;dur=800')
    expect(log).toHaveBeenCalledWith('[server-request-timing]', {
      scope: 'proxy', durationMs: 1700, outcome: 'success', phases: [
        { phase: 'auth', startMs: 0, durationMs: 900, outcome: 'success' },
        { phase: 'role', startMs: 900, durationMs: 800, outcome: 'success' },
      ],
    })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private|private-user-id/)
  })

  it('stays quiet below the slow threshold', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(100)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(profileServerRequest('admin-layout', measure => measure('auth', () => 'ok')))
      .resolves.toMatchObject({ value: 'ok' })
    expect(log).not.toHaveBeenCalled()
  })
})
