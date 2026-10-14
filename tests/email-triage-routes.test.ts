import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runScan: vi.fn() }))
vi.mock('@/lib/emailTriage/scan', () => ({ runEmailTriageScan: mocks.runScan }))

import { GET as cronGet } from '@/app/api/cron/email-triage/route'

function source(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

const request = (auth?: string) =>
  new Request('https://app.test/api/cron/email-triage', {
    headers: auth ? { authorization: auth } : {},
  })

describe('the triage cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'correct-secret'
    mocks.runScan.mockResolvedValue({ ok: true, queued: 2, draftsGenerated: 1 })
  })
  afterEach(() => { delete process.env.CRON_SECRET })

  it('refuses a request with no bearer', async () => {
    expect((await cronGet(request())).status).toBe(401)
    expect(mocks.runScan).not.toHaveBeenCalled()
  })

  it('refuses the wrong bearer', async () => {
    expect((await cronGet(request('Bearer wrong-secret'))).status).toBe(401)
    expect(mocks.runScan).not.toHaveBeenCalled()
  })

  it('refuses everything when CRON_SECRET is unset, rather than letting anyone in', async () => {
    delete process.env.CRON_SECRET
    expect((await cronGet(request('Bearer anything'))).status).toBe(401)
    expect(mocks.runScan).not.toHaveBeenCalled()
  })

  it('scans on the right bearer and reports what it did', async () => {
    const res = await cronGet(request('Bearer correct-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, queued: 2 })
    expect(mocks.runScan).toHaveBeenCalledWith({ trigger: 'cron' })
  })

  it('returns 200 with counts on a partial run rather than an error', async () => {
    // The scan is bounded and idempotent — what it did not reach stays queued
    // for the next pass — so a short run is normal, not something to alert on.
    mocks.runScan.mockResolvedValue({ ok: true, draftsGenerated: 5, remainingNeedsDraft: 12 })
    const res = await cronGet(request('Bearer correct-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ remainingNeedsDraft: 12 })
  })
})

describe('the triage routes', () => {
  const routes = [
    'app/api/admin/email-triage/route.ts',
    'app/api/admin/email-triage/records/route.ts',
    'app/api/admin/email-triage/scan/route.ts',
    'app/api/admin/email-triage/[id]/route.ts',
    'app/api/admin/email-triage/[id]/link/route.ts',
    'app/api/admin/email-triage/[id]/draft/route.ts',
    'app/api/admin/email-triage/[id]/approve/route.ts',
    'app/api/admin/email-triage/[id]/send/route.ts',
    'app/api/admin/email-triage/[id]/dismiss/route.ts',
    'app/api/admin/email-triage/[id]/message/route.ts',
  ]

  it('keeps a manual CRM link across scans', () => {
    const link = source('app/api/admin/email-triage/[id]/link/route.ts')
    expect(link).toContain('record_linked_manually')
    expect(link).toContain('resolveEmailTriageLink')
    const scan = source('lib/emailTriage/scan.ts')
    expect(scan).toContain('applyManualLinkOnScan')
    expect(scan).toContain('record_linked_manually')
  })

  it('all require an admin', () => {
    for (const route of routes) expect(source(route)).toContain('requireAdmin')
  })

  it('rate limits every route that spends money or Gmail quota', () => {
    for (const route of [
      'app/api/admin/email-triage/scan/route.ts',
      'app/api/admin/email-triage/[id]/draft/route.ts',
      'app/api/admin/email-triage/[id]/approve/route.ts',
      'app/api/admin/email-triage/[id]/send/route.ts',
      'app/api/admin/email-triage/[id]/message/route.ts',
    ]) {
      expect(source(route)).toContain('consumeRateLimit')
    }
  })

  it('gives the model-calling routes room to finish', () => {
    for (const route of [
      'app/api/admin/email-triage/scan/route.ts',
      'app/api/admin/email-triage/[id]/draft/route.ts',
    ]) {
      expect(source(route)).toContain('export const maxDuration = 60')
    }
  })

  it('approving creates a Gmail draft and never sends', () => {
    // Approve is the "finish it in Gmail" path. Sending is its own route,
    // behind its own confirmation, so the two can never be confused.
    const approve = source('app/api/admin/email-triage/[id]/approve/route.ts')
    expect(approve).toContain('createGmailDraft')
    expect(approve).not.toContain('sendViaGmail')
    expect(approve).not.toContain("from '@/lib/email/send'")
  })

  it('threads the draft onto the message being answered', () => {
    const approve = source('app/api/admin/email-triage/[id]/approve/route.ts')
    expect(approve).toContain('buildReplyHeaders')
    expect(approve).toContain('threadId: row.gmail_thread_id')
  })
})

describe('the cron registration', () => {
  const vercel = JSON.parse(source('vercel.json')) as { crons: { path: string; schedule: string }[] }
  const entries = vercel.crons.filter(entry => entry.path === '/api/cron/email-triage')

  it('is scheduled on weekday mornings', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) expect(entry.schedule).toMatch(/1-5$/)
  })

  it('runs before the daily digest, so the queue is warm when it arrives', () => {
    const digest = vercel.crons.find(entry => entry.path === '/api/cron/daily-digest')
    const minutes = (schedule: string) => {
      const [minute, hour] = schedule.split(' ')
      return Number(hour) * 60 + Number(minute)
    }
    expect(Math.min(...entries.map(entry => minutes(entry.schedule))))
      .toBeLessThan(minutes(digest!.schedule))
  })
})
