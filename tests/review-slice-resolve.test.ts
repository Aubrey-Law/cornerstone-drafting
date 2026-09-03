import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDocumentPath } from '@/lib/reviewSlice/resolvePath'
import { resolveAnthropicKey } from '@/lib/reviewSlice/resolveKey'

describe('finding the document', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-slice-'))
    file = path.join(dir, 'Jessica Shaw Revocable Trust.docx')
    fs.writeFileSync(file, 'x')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('takes a path that is simply correct', () => {
    const result = resolveDocumentPath(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolved.repair).toBe('none')
  })

  /**
   * Finder pastes a dragged path with its spaces backslash-escaped, which is
   * correct unquoted — but inside quotes a backslash before a space is not an
   * escape, so the filename arrives containing literal backslashes. Quoting and
   * escaping are alternatives, and doing both is the commonest way this fails.
   */
  it('recovers a path that was both quoted and backslash-escaped', () => {
    const result = resolveDocumentPath(file.replace(/ /g, '\\ '))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolved.path).toBe(file)
    expect(result.resolved.repair).toBe('unescaped')
  })

  it('recovers an absolute path that lost its leading slash', () => {
    // Only meaningful under a /Users or /home style root.
    const rooted = '/Users/someone/x.docx'
    const withoutSlash = rooted.slice(1)
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation(p => p === rooted)
    const statSpy = vi
      .spyOn(fs, 'statSync')
      .mockReturnValue({ isFile: () => true } as unknown as fs.Stats)

    const result = resolveDocumentPath(withoutSlash)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resolved.repair).toBe('absolute')

    spy.mockRestore()
    statSpy.mockRestore()
  })

  it('does not accept a directory as the document', () => {
    expect(resolveDocumentPath(dir).ok).toBe(false)
  })

  /**
   * A miss on a path that is nearly right should say which half is wrong. A
   * directory that exists means the filename is the problem, so listing what is
   * actually in there is the useful answer.
   */
  it('lists the documents in a directory that exists', () => {
    const result = resolveDocumentPath(path.join(dir, 'Wrong Name.docx'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('check the filename')
    expect(result.message).toContain('Jessica Shaw Revocable Trust.docx')
  })

  it('explains the quoting rule when the path still has escapes in it', () => {
    const result = resolveDocumentPath('/nowhere/a\\ file.docx')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/alternatives/)
  })

  it('shows where it looked for a relative path', () => {
    const result = resolveDocumentPath('Users/someone/missing.docx')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Looked for it at:')
  })
})

function adminWithRows(rows: unknown[], error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: error ? null : rows, error })),
      })),
    })),
  } as unknown as SupabaseClient
}

describe('finding the Anthropic key', () => {
  const original = { ...process.env }

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_API_KEY
    delete process.env.USER_API_KEYS_ENCRYPTION_SECRET
  })

  afterEach(() => {
    process.env = { ...original }
  })

  it('prefers an environment variable', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env'
    const result = await resolveAnthropicKey(null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toBe('env')
  })

  it('accepts the CLAUDE_API_KEY spelling the app also accepts', async () => {
    process.env.CLAUDE_API_KEY = 'sk-ant-alt'
    const result = await resolveAnthropicKey(null)
    expect(result.ok).toBe(true)
  })

  /**
   * The message is the deliverable when nothing is found: the app resolves a
   * key saved in Settings ahead of the environment, so "could not resolve
   * authentication" on a machine where the app works is a confusing thing to be
   * told. Both places, named.
   */
  it('names both places it looked when there is no key', async () => {
    const result = await resolveAnthropicKey(null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Settings → API keys')
    expect(result.message).toContain('ANTHROPIC_API_KEY')
    expect(result.message).toContain('.env.local')
  })

  it('says the encryption secret is missing rather than that no key exists', async () => {
    const result = await resolveAnthropicKey(adminWithRows([{ user_id: 'u1' }]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('USER_API_KEYS_ENCRYPTION_SECRET')
  })

  /**
   * With no signed-in user, the saved key is chosen by there being exactly one.
   * Picking between several people's keys would bill the wrong account and be
   * invisible doing it.
   */
  it('refuses to choose when several people have saved a key', async () => {
    process.env.USER_API_KEYS_ENCRYPTION_SECRET = 'x'.repeat(32)
    const result = await resolveAnthropicKey(
      adminWithRows([
        { user_id: 'u1', encrypted_key: 'a', iv: 'b', auth_tag: 'c' },
        { user_id: 'u2', encrypted_key: 'd', iv: 'e', auth_tag: 'f' },
      ]),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('2 people')
  })

  it('reports a read failure rather than claiming no key is saved', async () => {
    process.env.USER_API_KEYS_ENCRYPTION_SECRET = 'x'.repeat(32)
    const result = await resolveAnthropicKey(adminWithRows([], { message: 'permission denied' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('permission denied')
  })
})
