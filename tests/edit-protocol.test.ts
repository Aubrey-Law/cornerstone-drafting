import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  EDITS_CLOSE_TAG,
  EDITS_OPEN_TAG,
  MAX_ORIGINAL_CHARS,
  buildContextAnchoredEditPrompt,
  buildEditProtocolInstructions,
  parseEditsBlock,
  toEditInput,
} from '@/lib/drafting/editProtocol'

function wrap(json: string): string {
  return `Here is what I changed.\n\n${EDITS_OPEN_TAG}\n${json}\n${EDITS_CLOSE_TAG}\n\nLet me know.`
}

describe('parseEditsBlock', () => {
  it('extracts edits and strips the transport block from the prose', () => {
    const result = parseEditsBlock(
      wrap('[{"original":"Jane Doe","replacement":"Robert Smith","reason":"New trustee."}]'),
    )
    expect(result.edits).toEqual([
      { original: 'Jane Doe', replacement: 'Robert Smith', reason: 'New trustee.' },
    ])
    expect(result.prose).toBe('Here is what I changed.\n\nLet me know.')
    expect(result.malformed).toBe(false)
  })

  it('treats a reply with no block as a plain answer, not a failure', () => {
    const result = parseEditsBlock('The trustee is Jane Doe.')
    expect(result.edits).toEqual([])
    expect(result.prose).toBe('The trustee is Jane Doe.')
    expect(result.malformed).toBe(false)
  })

  it('tolerates a fenced block despite the prompt forbidding one', () => {
    const result = parseEditsBlock(
      wrap('```json\n[{"original":"A","replacement":"B","reason":"r"}]\n```'),
    )
    expect(result.edits).toHaveLength(1)
  })

  it('reports malformed JSON rather than silently proposing nothing', () => {
    const result = parseEditsBlock(wrap('[{"original":'))
    expect(result.edits).toEqual([])
    expect(result.malformed).toBe(true)
  })

  it('accepts a format-only edit', () => {
    const result = parseEditsBlock(
      wrap('[{"original":"ARTICLE I","formats":["bold","heading1"],"reason":"Heading."}]'),
    )
    expect(result.edits[0]).toEqual({
      original: 'ARTICLE I',
      formats: ['bold', 'heading1'],
      reason: 'Heading.',
    })
  })

  it('drops an edit with neither a replacement nor a valid format', () => {
    const result = parseEditsBlock(
      wrap('[{"original":"A","formats":["rainbow"],"reason":"r"},{"original":"B"}]'),
    )
    expect(result.edits).toEqual([])
    expect(result.malformed).toBe(true)
  })

  it('drops an original longer than Word can search for', () => {
    const tooLong = 'x'.repeat(MAX_ORIGINAL_CHARS + 1)
    const result = parseEditsBlock(
      wrap(JSON.stringify([{ original: tooLong, replacement: 'y', reason: 'r' }])),
    )
    expect(result.edits).toEqual([])
  })

  it('keeps an explicit replace-all opt-in and ignores any other value', () => {
    const parsed = parseEditsBlock(
      wrap(
        '[{"original":"A","replacement":"B","reason":"r","occurrence":"all"},' +
          '{"original":"C","replacement":"D","reason":"r","occurrence":"first"}]',
      ),
    )
    expect(parsed.edits[0].occurrence).toBe('all')
    expect(parsed.edits[1].occurrence).toBeUndefined()
  })

  it('treats an empty replacement as a deletion, not a missing field', () => {
    const result = parseEditsBlock(
      wrap('[{"original":"strike this","replacement":"","reason":"Removed."}]'),
    )
    expect(result.edits[0].replacement).toBe('')
  })
})

describe('toEditInput', () => {
  it('maps a text edit onto the OOXML applier contract', () => {
    expect(toEditInput({ original: 'A', replacement: 'B', reason: 'r' })).toEqual({
      find: 'A',
      replace: 'B',
      context_before: '',
      context_after: '',
      reason: 'r',
    })
  })

  it('returns null for a format-only edit, which has no OOXML equivalent', () => {
    expect(toEditInput({ original: 'A', formats: ['bold'], reason: 'r' })).toBeNull()
  })
})

describe('prompts', () => {
  it('teaches the Word protocol the constraints its applier depends on', () => {
    const prompt = buildEditProtocolInstructions()
    expect(prompt).toContain(EDITS_OPEN_TAG)
    expect(prompt).toContain(String(MAX_ORIGINAL_CHARS))
    expect(prompt).toContain('occurs exactly once')
    expect(prompt).toContain('Never edit a list number')
  })

  it('keeps the context-anchored prompt distinct, since its applier locates differently', () => {
    const prompt = buildContextAnchoredEditPrompt({
      documentText: 'DOC BODY',
      instruction: 'INSTRUCTION',
    })
    expect(prompt).toContain('DOC BODY')
    expect(prompt).toContain('INSTRUCTION')
    expect(prompt).toContain('context_before')
    // The Word protocol's uniqueness rule would throw away this applier's
    // ability to place a short non-unique find with surrounding context.
    expect(prompt).not.toContain(EDITS_OPEN_TAG)
  })

  it('shares the invented-facts rule across both prompts', () => {
    const shared = 'Do not invent parties'
    expect(buildEditProtocolInstructions()).toContain(shared)
    expect(buildContextAnchoredEditPrompt({ documentText: '', instruction: '' })).toContain(shared)
  })
})

describe('the pane copy of the contract', () => {
  /**
   * The add-in is a separate npm project and cannot import from `lib/`, so it
   * carries its own copy of the parser. These pin the two together: changing
   * one without the other fails here rather than in Word.
   */
  const paneSource = fs.readFileSync(
    path.join(process.cwd(), 'word-addin/src/word/editTypes.ts'),
    'utf8',
  )

  it('agrees on the transport tags and limits', () => {
    expect(paneSource).toContain(`export const EDITS_OPEN_TAG = '${EDITS_OPEN_TAG}'`)
    expect(paneSource).toContain(`export const EDITS_CLOSE_TAG = '${EDITS_CLOSE_TAG}'`)
    expect(paneSource).toContain(`export const MAX_ORIGINAL_CHARS = ${MAX_ORIGINAL_CHARS}`)
  })

  it('agrees on the format vocabulary the prompt advertises', () => {
    // [\s\S] rather than the dotAll `s` flag: the root tsconfig targets ES6,
    // where that flag is a compile error.
    const formats = paneSource.match(/export const EDIT_FORMATS = \[([\s\S]*?)\]/)?.[1] ?? ''
    for (const format of ['bold', 'italic', 'underline', 'heading1', 'heading2', 'heading3']) {
      expect(formats).toContain(`'${format}'`)
      expect(buildEditProtocolInstructions()).toContain(`"${format}"`)
    }
  })
})
