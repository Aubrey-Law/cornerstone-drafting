import { afterEach, describe, expect, it, vi } from 'vitest'
import { profileMatterDetail } from '@/lib/performance/matterDetailTiming'

afterEach(() => vi.restoreAllMocks())

describe('matter detail timing', () => {
  it('preserves overlapping reads and stays quiet for a fast page', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    let release!: (value: string) => void
    const waiting = new Promise<string>(resolve => { release = resolve })
    const started: string[] = []
    const result = profileMatterDetail(async measure => Promise.all([
      measure('core', () => { started.push('core'); return waiting }),
      measure('contacts', () => { started.push('contacts'); return 'contacts' }),
    ]))
    expect(started).toEqual(['core', 'contacts'])
    release('matter')
    await expect(result).resolves.toEqual(['matter', 'contacts'])
    expect(log).not.toHaveBeenCalled()
  })

  it('reports slow phases without logging their returned legal data', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const secret = { client: 'Private Client', notes: 'Private legal instructions' }
    const result = await profileMatterDetail(async measure => {
      await measure('identity', () => { now = 100; return 'private-id' })
      return measure('intake-snapshot', async () => { now = 2100; return secret })
    })
    expect(result).toBe(secret)
    expect(log).toHaveBeenCalledWith('[matter-detail-timing]', {
      durationMs: 2100, outcome: 'success', phases: [
        { phase: 'identity', startMs: 0, durationMs: 100, outcome: 'success' },
        { phase: 'intake-snapshot', startMs: 100, durationMs: 2000, outcome: 'success' },
      ],
    })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private|private-id/)
  })

  it('preserves the exact rejection and reports pending work without error text', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = new Error('Private database error with client details')
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const result = profileMatterDetail(measure => Promise.all([
      measure('core', () => { throw error }),
      measure('contacts', () => waiting),
    ]))
    await expect(result).rejects.toBe(error)
    const report = log.mock.calls[0][1]
    expect(report).toMatchObject({ outcome: 'error', phases: [
      { phase: 'core', outcome: 'error' }, { phase: 'contacts', outcome: 'pending' },
    ] })
    release()
    await waiting
    expect(report.phases[1].outcome).toBe('pending')
    expect(JSON.stringify(log.mock.calls)).not.toContain(error.message)
  })

  it('does not turn a diagnostic logger failure into a page failure', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(2000)
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('logger failed') })
    await expect(profileMatterDetail(async () => 'page')).resolves.toBe('page')
  })
})
