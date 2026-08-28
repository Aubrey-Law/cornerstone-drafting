import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { r2Bucket } from '@/lib/r2'

/**
 * VERCEL_ENV_CHECKLIST.md used to tell operators to set `R2_BUCKET`, which
 * nothing reads, while the code read `R2_BUCKET_NAME` and quietly fell back to
 * a literal 'legal-documents'. An operator following the checklist would have
 * had client documents addressed to a bucket nobody chose.
 */
describe('r2Bucket', () => {
  beforeEach(() => {
    vi.stubEnv('R2_BUCKET_NAME', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the configured bucket when set', () => {
    vi.stubEnv('R2_BUCKET_NAME', 'aubrey-client-documents')
    expect(r2Bucket()).toBe('aubrey-client-documents')
  })

  it('trims surrounding whitespace from the configured value', () => {
    vi.stubEnv('R2_BUCKET_NAME', '  aubrey-client-documents  ')
    expect(r2Bucket()).toBe('aubrey-client-documents')
  })

  it('falls back to the development default outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(r2Bucket()).toBe('legal-documents')
  })

  it('refuses to guess a bucket in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => r2Bucket()).toThrow(/R2_BUCKET_NAME is not set/)
  })

  it('treats a blank value in production as unset', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('R2_BUCKET_NAME', '   ')
    expect(() => r2Bucket()).toThrow(/R2_BUCKET_NAME is not set/)
  })

  it('fails at call time, not module load, so next build survives', () => {
    // A module-level throw would break `next build`, which evaluates route
    // modules with NODE_ENV=production. Importing lib/r2 must stay safe.
    const source = readFileSync(path.join(process.cwd(), 'lib/r2.ts'), 'utf8')
    expect(source).toContain('export function r2Bucket()')
    expect(source).not.toMatch(/^export const R2_BUCKET/m)
  })

  it('is documented under the name the code actually reads', () => {
    const checklist = readFileSync(path.join(process.cwd(), 'VERCEL_ENV_CHECKLIST.md'), 'utf8')
    expect(checklist).toContain('`R2_BUCKET_NAME`')
    expect(checklist).not.toMatch(/`R2_BUCKET`/)
  })
})
