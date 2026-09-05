import { describe, expect, it } from 'vitest'
import { parseArgs } from '@/lib/reviewSlice/args'

describe('review CLI arguments', () => {
  it('reads a flag and its value', () => {
    const result = parseArgs(['--file', 'draft.docx'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.file).toBe('draft.docx')
  })

  it('treats a flag with no value as a switch', () => {
    const result = parseArgs(['--file', 'draft.docx', '--layer-only'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args['layer-only']).toBe(true)
  })

  /**
   * The case this exists for. Every document at this firm is named
   * `Date_Client Name_Document Type.docx`, so an unquoted path reaches here in
   * pieces — and the obvious parser rejects the second piece with a message
   * naming a word the caller never typed as an argument.
   */
  it('rejoins a path the shell split on spaces', () => {
    const result = parseArgs([
      '--file',
      '/Users/x/drafts/2026-06-17_Ran',
      'Duchin_Health',
      'Care',
      'Proxy.docx',
      '--layer-only',
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.file).toBe('/Users/x/drafts/2026-06-17_Ran Duchin_Health Care Proxy.docx')
    expect(result.args['layer-only']).toBe(true)
  })

  it('leaves a quoted path exactly as given', () => {
    const path = '/Users/x/drafts/2026-06-17_Ran Duchin_Health Care Proxy.docx'
    const result = parseArgs(['--file', path])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.file).toBe(path)
  })

  it('keeps several switches and values apart', () => {
    const result = parseArgs([
      '--file', 'a trust.docx',
      '--playbook', 'tools/workflows/review/ma-trust-firm-qa.json',
      '--redline', '/tmp/marked up.docx',
      '--layer-only',
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual({
      file: 'a trust.docx',
      playbook: 'tools/workflows/review/ma-trust-firm-qa.json',
      redline: '/tmp/marked up.docx',
      'layer-only': true,
    })
  })

  it('rejects a leading argument that is not a flag, and says what a flag looks like', () => {
    const result = parseArgs(['draft.docx'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('draft.docx')
    expect(result.error).toContain('--file')
  })

  it('returns nothing for no arguments rather than failing', () => {
    const result = parseArgs([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual({})
  })
})
