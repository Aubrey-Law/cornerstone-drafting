import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const script = path.join(process.cwd(), 'scripts/firma-engagement-poc.mjs')

function run(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  })
}

describe('Firma engagement POC safety guards', () => {
  it('fails before doing work when the POC environment is incomplete', () => {
    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing POC environment')
  })

  it('refuses an explicitly production-marked workspace', () => {
    const result = run({
      FIRMA_API_KEY: 'test-only',
      FIRMA_POC_DOCX: '/does/not/matter.docx',
      FIRMA_POC_RECIPIENT_EMAIL: 'tester@example.com',
      FIRMA_POC_WORKSPACE: 'production',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing production Firma execution')
  })

  it('refuses a real recipient unless explicitly allowed', () => {
    const result = run({
      FIRMA_API_KEY: 'test-only',
      FIRMA_POC_DOCX: '/does/not/matter.docx',
      FIRMA_POC_RECIPIENT_EMAIL: 'person@aubreylegal.com',
      FIRMA_POC_WORKSPACE: 'sandbox',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing a real recipient')
  })
})
