import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
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
  it('uses the documented Firma anchor tag property', () => {
    const source = fs.readFileSync(script, 'utf8')
    expect(source).toContain("anchor_string: '[[CLIENT_1_SIGNATURE]]'")
    expect(source).toContain("anchor_string: '[[CLIENT_1_DATE]]'")
    expect(source.match(/remove_anchor_text: true/g)).toHaveLength(2)
    expect(source).not.toMatch(/\{ anchor:/)
  })

  it('fails before doing work when the POC environment is incomplete', () => {
    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing POC environment')
  })

  it.each(['production', 'prod'])('refuses the %s workspace sentinel', (workspace) => {
    const result = run({
      FIRMA_API_KEY: 'test-only',
      FIRMA_POC_DOCX: '/does/not/matter.docx',
      FIRMA_POC_RECIPIENT_EMAIL: 'tester@example.com',
      FIRMA_POC_WORKSPACE: workspace,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('explicitly names a non-production environment')
  })

  it('refuses FIRMA_POC_SEND before reading the source document', () => {
    const result = run({
      FIRMA_API_KEY: 'test-only',
      FIRMA_POC_DOCX: '/does/not/matter.docx',
      FIRMA_POC_RECIPIENT_EMAIL: 'tester@example.com',
      FIRMA_POC_WORKSPACE: 'sandbox',
      FIRMA_POC_SEND: 'true',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('FIRMA_POC_SEND is not enabled')
    expect(result.stderr).not.toContain('ENOENT')
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
