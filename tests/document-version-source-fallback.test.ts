import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ put: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/documentUpload', () => ({
  putFileToR2: mocks.put,
  safeUploadFilename: (name: string) => name,
}))

import { createDocumentVersion } from '@/lib/documentVersions'
import type { SupabaseClient } from '@supabase/supabase-js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(mocks.warn)
})

const CHECK_VIOLATION = {
  code: '23514',
  message:
    'new row for relation "document_versions" violates check constraint "document_versions_source_check"',
  details: 'Failing row contains (…, word_addin, …).',
}

/**
 * A client that fails the first N inserts with `error` and then succeeds,
 * recording the source each attempt sent.
 */
function clientRejecting(error: Record<string, unknown>, failures: number) {
  const attempted: string[] = []
  let failed = 0
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'update']) chain[method] = () => chain
  chain.insert = (values: { source: string }) => {
    attempted.push(values.source)
    return chain
  }
  chain.maybeSingle = async () => ({ data: { version_number: 1 }, error: null })
  chain.single = async () => {
    if (failed < failures) {
      failed += 1
      return { data: null, error }
    }
    return { data: { id: 'v2', version_number: 2 }, error: null }
  }
  return { admin: { from: () => chain } as unknown as SupabaseClient, attempted }
}

const save = (admin: SupabaseClient, extra: { sourceFallback?: 'user_upload' } = {}) =>
  createDocumentVersion({
    admin,
    documentId: 'doc',
    matterId: 'matter',
    bytes: Buffer.from('docx'),
    filename: 'Trust.docx',
    contentType: 'docx',
    source: 'word_addin',
    createdBy: 'u',
    ...extra,
  })

/**
 * A migration and the code that needs it ship on the same push and finish
 * independently, so for a minute new code can meet the old constraint. By the
 * time the insert runs the bytes are already in R2: failing there would lose
 * the attorney's save and orphan the object over what is only a label.
 */
describe('a source the database does not know yet', () => {
  it('saves the version under the fallback source instead of failing', async () => {
    const { admin, attempted } = clientRejecting(CHECK_VIOLATION, 1)

    const result = await save(admin, { sourceFallback: 'user_upload' })

    expect(result).toEqual({ version: { id: 'v2', version_number: 2 } })
    expect(attempted).toEqual(['word_addin', 'user_upload'])
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('user_upload'))
  })

  it('does not re-upload the bytes to retry', async () => {
    // r2Key is timestamp-based rather than version-based, so the object written
    // before the first attempt is the one the fallback row points at.
    const { admin } = clientRejecting(CHECK_VIOLATION, 1)

    await save(admin, { sourceFallback: 'user_upload' })

    expect(mocks.put).toHaveBeenCalledTimes(1)
  })

  it('falls back once, not around a loop', async () => {
    // A check violation that survives the fallback is about something else, and
    // retrying it would only spend attempts the unique-number collision needs.
    const { admin, attempted } = clientRejecting(CHECK_VIOLATION, 3)

    const result = await save(admin, { sourceFallback: 'user_upload' })

    expect(result).toEqual({ error: CHECK_VIOLATION.message })
    expect(attempted).toEqual(['word_addin', 'user_upload'])
  })

  it('leaves a caller that named no fallback to fail', async () => {
    // Every other writer's source has been in the constraint for releases. A
    // silent substitution there would be a lie about what produced the bytes.
    const { admin, attempted } = clientRejecting(CHECK_VIOLATION, 1)

    const result = await save(admin)

    expect(result).toEqual({ error: CHECK_VIOLATION.message })
    expect(attempted).toEqual(['word_addin'])
  })

  it('does not substitute a source for an unrelated check violation', async () => {
    const other = { ...CHECK_VIOLATION, message: 'violates check constraint "some_other_check"', details: '' }
    const { admin, attempted } = clientRejecting(other, 1)

    const result = await save(admin, { sourceFallback: 'user_upload' })

    expect(result).toEqual({ error: other.message })
    expect(attempted).toEqual(['word_addin'])
  })

  it('still retries a version-number collision, under the source it was given', async () => {
    const { admin, attempted } = clientRejecting(
      { code: '23505', message: 'duplicate key value violates unique constraint', details: '' },
      1,
    )

    const result = await save(admin, { sourceFallback: 'user_upload' })

    expect(result).toEqual({ version: { id: 'v2', version_number: 2 } })
    expect(attempted).toEqual(['word_addin', 'word_addin'])
  })
})
