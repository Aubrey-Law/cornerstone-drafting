import { afterEach, describe, expect, it, vi } from 'vitest'
import { pokeTick } from '@/lib/runs/enqueue'

/**
 * `pokeTick` — the nudge that makes a queued run start now instead of
 * waiting up to a minute for cron. Fire-and-forget, so the only things worth
 * proving are: it never calls out with no secret configured, it resolves the
 * absolute URL correctly (`VERCEL_URL`, or localhost), and a failed poke
 * never becomes an error.
 *
 * `process.env` is restored after each test the same way
 * `tests/tick-route.test.ts` restores `CRON_SECRET` — mutating it directly
 * and putting it back, rather than `vi.stubEnv`, so a leftover value can't
 * leak into another file's tests.
 */

const ORIGINAL_SECRET = process.env.CRON_SECRET
const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL

function restoreEnv() {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
  if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL
  else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL
}

describe('pokeTick', () => {
  afterEach(() => {
    restoreEnv()
    vi.unstubAllGlobals()
  })

  it('does nothing when no secret is configured', async () => {
    delete process.env.CRON_SECRET
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pokeTick()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to localhost when VERCEL_URL is unset', async () => {
    process.env.CRON_SECRET = 'secret'
    delete process.env.VERCEL_URL
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await pokeTick()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/cron/tick',
      { headers: { authorization: 'Bearer secret' } },
    )
  })

  it('resolves an absolute URL from VERCEL_URL — a relative fetch works locally and does nothing in production', async () => {
    process.env.CRON_SECRET = 'secret'
    process.env.VERCEL_URL = 'workbench-git-abc123.vercel.app'
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await pokeTick()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://workbench-git-abc123.vercel.app/api/cron/tick',
      { headers: { authorization: 'Bearer secret' } },
    )
  })

  it('swallows a failed poke without throwing — cron is the guarantee, this is only the hurry', async () => {
    process.env.CRON_SECRET = 'secret'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    await expect(pokeTick()).resolves.toBeUndefined()
  })
})
