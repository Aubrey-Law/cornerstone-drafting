import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../app/api/health/route'
import { REQUIRED_SERVER_ENV } from '../lib/env'

describe('GET /api/health', () => {
  it('answers liveness with 200 regardless of configuration', async () => {
    const res = await GET(new NextRequest('http://workbench.test/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, app: 'workbench' })
  })

  it('reports incomplete environment as 503 with the missing names', async () => {
    const saved = Object.fromEntries(REQUIRED_SERVER_ENV.map((n) => [n, process.env[n]]))
    for (const name of REQUIRED_SERVER_ENV) delete process.env[name]
    try {
      const res = await GET(new NextRequest('http://workbench.test/api/health?check=env'))
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.env.missing).toEqual([...REQUIRED_SERVER_ENV])
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})
