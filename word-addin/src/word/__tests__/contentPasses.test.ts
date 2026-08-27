import { describe, expect, it } from 'vitest'
import {
  articleTitlesPass,
  notaryBlocksPass,
  runInSectionsPass,
} from '../formatting/contentPasses'

describe('articleTitlesPass', () => {
  it('splits a title that shares a line with its article number', () => {
    const { edits } = articleTitlesPass(['ARTICLE IV  Powers of the Trustee'])
    expect(edits).toHaveLength(1)
    expect(edits[0].after).toBe('ARTICLE IV')
    expect(edits[0].insertAfter?.[0].text).toBe('Powers of the Trustee')
  })

  it('leaves an article heading that is already on its own line', () => {
    // Makes the pass safe to run twice.
    expect(articleTitlesPass(['ARTICLE IV', 'Powers of the Trustee']).edits).toEqual([])
  })

  it('ignores a cross-reference that merely opens with an article number', () => {
    const paragraphs = [
      'ARTICLE IV shall govern the administration of the trust. The trustee may act.',
    ]
    expect(articleTitlesPass(paragraphs).edits).toEqual([])
  })

  it('handles arabic and word-form numbering', () => {
    expect(articleTitlesPass(['Article 7: Distributions']).edits).toHaveLength(1)
    expect(articleTitlesPass(['ARTICLE Fourth — Trustee Succession']).edits).toHaveLength(1)
  })
})

describe('notaryBlocksPass', () => {
  const block = [
    'IN WITNESS WHEREOF, the Settlor has signed this instrument.',
    'COMMONWEALTH OF MASSACHUSETTS',
    'County of Norfolk',
    'On this day personally appeared the above-named Settlor and acknowledged the foregoing.',
    '____________________________',
  ]

  it('centers the jurisdiction and county lines at 12pt', () => {
    const { edits } = notaryBlocksPass(block)
    const centered = edits.filter(e => e.format?.alignment === 'centered')
    expect(centered.map(e => e.before)).toEqual([
      'COMMONWEALTH OF MASSACHUSETTS',
      'County of Norfolk',
    ])
    expect(centered.every(e => e.format?.fontSizePt === 12)).toBe(true)
  })

  it('adds the notary labels under the signature rule at a 3-inch indent', () => {
    const { edits } = notaryBlocksPass(block)
    const signature = edits.find(e => e.insertAfter)
    expect(signature?.insertAfter?.map(p => p.text)).toEqual([
      'Notary Public',
      'My Commission Expires:',
    ])
    // 216pt = 3 inches.
    expect(signature?.insertAfter?.every(p => p.leftIndentPt === 216)).toBe(true)
  })

  it('does not add labels that are already there', () => {
    const already = [...block, 'Notary Public', 'My Commission Expires:']
    expect(notaryBlocksPass(already).edits.some(e => e.insertAfter)).toBe(false)
  })

  it('ignores a signature rule that is not part of a notary block', () => {
    const witnessLine = ['The parties agree as follows.', '____________________________']
    expect(notaryBlocksPass(witnessLine).edits).toEqual([])
  })
})

describe('runInSectionsPass', () => {
  it('folds the intro paragraph up into its section heading', () => {
    const { edits } = runInSectionsPass([
      '4.1 Trustee Compensation',
      'The Trustee shall be entitled to reasonable compensation.',
    ])
    expect(edits).toHaveLength(1)
    expect(edits[0].after).toBe(
      '4.1. Trustee Compensation. The Trustee shall be entitled to reasonable compensation.',
    )
  })

  it('leaves a heading whose next paragraph is another heading', () => {
    expect(runInSectionsPass(['4.1 Powers', '4.2 Duties']).edits).toEqual([])
  })

  it('leaves a heading followed by a list item rather than prose', () => {
    expect(runInSectionsPass(['4.1 Powers', '(a) to sell any asset;']).edits).toEqual([])
  })

  it('leaves a heading with nothing after it', () => {
    expect(runInSectionsPass(['4.1 Powers']).edits).toEqual([])
  })
})
