import { afterEach, describe, expect, it } from 'vitest'
import { r2Bucket } from '@/lib/storage/r2'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

/**
 * The same discipline the old app arrived at the hard way: an unset bucket used
 * to fall back to a default nobody chose, and the deployment checklist named a
 * variable nothing read — so an operator who followed it addressed the wrong
 * bucket silently, for client documents.
 */
describe('r2Bucket', () => {
  it('uses the configured bucket', () => {
    process.env.R2_BUCKET_NAME = 'legal-documents-prod'
    expect(r2Bucket()).toBe('legal-documents-prod')
  })

  it('refuses to guess in production', () => {
    delete process.env.R2_BUCKET_NAME
    // NODE_ENV is typed readonly under Next's types; the record is not.
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    expect(() => r2Bucket()).toThrow(/R2_BUCKET_NAME/)
  })

  it('keeps the local default outside production, so tests need no setup', () => {
    delete process.env.R2_BUCKET_NAME
    ;(process.env as Record<string, string>).NODE_ENV = 'test'
    expect(r2Bucket()).toBe('legal-documents')
  })

  it('treats a blank value as unset rather than as a bucket named nothing', () => {
    process.env.R2_BUCKET_NAME = '   '
    ;(process.env as Record<string, string>).NODE_ENV = 'test'
    expect(r2Bucket()).toBe('legal-documents')
  })
})

describe('the storage module', () => {
  it('imports without credentials, so a build that never reads a document still builds', async () => {
    for (const key of Object.keys(process.env)) if (key.startsWith('R2_')) delete process.env[key]
    await expect(import('@/lib/storage/r2')).resolves.toBeTruthy()
  })
})
