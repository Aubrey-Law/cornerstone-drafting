import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STEPS } from '../signIn'

/**
 * The dialog and the pane must never say the same thing while waiting.
 *
 * They both said "Checking your session…" once. A screenshot of a stuck dialog
 * and a screenshot of a stuck pane were then the same picture, and four shipped
 * fixes — every one a real bug, none of them this one — went to the pane while
 * the attorney was looking at the dialog. The wording is not cosmetic; it is
 * how anyone tells which half of the handshake failed.
 */

const SRC = resolve(import.meta.dirname, '../..')
const read = (relative: string) => readFileSync(resolve(SRC, relative), 'utf8')

/**
 * Comments are stripped first, and that is not a detail.
 *
 * The first version of this guard was written while a doc comment in the file
 * quoted the very string it was policing, so the guard failed at baseline for a
 * reason that had nothing to do with the UI. Only rendered copy counts.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/** Sentence-ish waiting copy: a capitalised run ending in an ellipsis. */
const waitingPhrases = (source: string) =>
  new Set(
    Array.from(stripComments(source).matchAll(/([A-Z][^<>'"`{}\n]{8,}?…)/g), m =>
      m[1].trim(),
    ),
  )

const paneSource = read('taskpane/App.tsx')
const dialogSource = read('dialog/App.tsx')

describe('dialog and pane vocabularies', () => {
  const pane = waitingPhrases(paneSource)

  it('finds the pane’s waiting copy at all', () => {
    // Without this, an extraction that quietly matches nothing would make every
    // assertion below pass vacuously — which is exactly how the first version
    // of this guard went green against the collision it existed to catch.
    expect(pane.size).toBeGreaterThan(0)
    expect([...pane]).toContain('Checking your session…')
  })

  it('shares no waiting phrase with the dialog', () => {
    const dialog = waitingPhrases(dialogSource)
    const shared = [...dialog].filter(phrase => pane.has(phrase))
    expect(shared).toEqual([])
  })

  it('gives every step a label the pane does not use', () => {
    // Step labels carry no ellipsis of their own — the spinner supplies it — so
    // compare them against the pane's phrases with theirs removed.
    const paneBare = new Set([...pane].map(phrase => phrase.replace(/…$/, '')))
    for (const { label } of STEPS) {
      expect(paneBare.has(label)).toBe(false)
      expect(paneSource).not.toContain(label)
    }
  })
})
