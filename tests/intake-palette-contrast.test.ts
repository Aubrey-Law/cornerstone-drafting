import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { contrastRatio } from '@/lib/theme/contrast'

/**
 * The client interview's palette, measured.
 *
 * It lives in a scoped block in globals.css rather than in the theme's token
 * file, which is how it drifted: Wave 1 measured and fixed the whole admin
 * theme and this block sat outside the net. Its field borders were still at
 * 1.51:1 afterwards, which is what this now stops.
 *
 * The values are read out of the CSS rather than restated here, so editing the
 * block is what these assert against. Restating them would make the test agree
 * with itself while the app rendered something else.
 */

const ROOT = join(__dirname, '..')

function declarationsIn(css: string, selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart)
  if (start === -1) throw new Error(`Selector not found: ${selectorStart}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  if (open === -1 || close === -1) throw new Error(`Unterminated block: ${selectorStart}`)

  const out: Record<string, string> = {}
  for (const line of css.slice(open + 1, close).split('\n')) {
    // Strip trailing same-line comments before matching.
    const match = line.replace(/\/\*.*?\*\//g, '').match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/)
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
const generated = readFileSync(join(ROOT, 'packages/ui/styles/theme/generated.css'), 'utf8')

const intake = declarationsIn(globals, ':root:not(.dark) .guided-interview:not(.guided-zinc),')

/**
 * The brand tokens the block now references. generated.css declares the light
 * theme first and redefines it under `.dark` further down, so everything before
 * that selector is the light value — which is the only one the interview can
 * see, the portal and intake being pinned light.
 */
const brand: Record<string, string> = {}
for (const line of generated.slice(0, generated.indexOf('.dark,')).split('\n')) {
  const match = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/)
  if (match) brand[match[1]] = match[2].trim()
}

/** Follows a single `var(--x)` indirection, which is all the block uses. */
function resolve(value: string): string {
  const match = value.match(/^var\((--[\w-]+)\)$/)
  if (!match) return value
  const target = brand[match[1]]
  if (!target) throw new Error(`Unresolvable: ${value}`)
  return target
}

const token = (name: string): string => {
  const raw = intake[name]
  if (!raw) throw new Error(`Missing token in the interview block: ${name}`)
  return resolve(raw)
}

describe('client interview palette', () => {
  it('draws its brand from the theme rather than a second blue', () => {
    // The defect this fixes: guided.css draws headings in #1f2d5a and these
    // utilities drew the fills beside them in #1E4A8C.
    expect(token('--accent').toLowerCase()).toBe(brand['--brand-navy'].toLowerCase())
    expect(token('--primary').toLowerCase()).toBe(brand['--brand-navy'].toLowerCase())
    expect(token('--ring').toLowerCase()).toBe(brand['--brand-teal'].toLowerCase())
    expect(token('--accent')).not.toMatch(/1E4A8C/i)
  })

  describe('text meets AA (4.5:1)', () => {
    const cases: [string, string, string][] = [
      ['body text on the card', '--foreground', '--card'],
      ['body text on the page', '--foreground', '--background'],
      ['secondary text on the page', '--muted-foreground', '--background'],
      ['secondary text on the card', '--muted-foreground', '--card'],
      ['secondary text on muted', '--muted-foreground', '--muted'],
      ['brand text on the card', '--accent', '--card'],
      ['brand text on the page', '--accent', '--background'],
      ['brand text on muted', '--accent', '--muted'],
      ['label on a brand fill', '--accent-foreground', '--accent'],
      ['label on a primary fill', '--primary-foreground', '--primary'],
      ['label on a destructive fill', '--destructive-foreground', '--destructive'],
      ['secondary label on secondary', '--secondary-foreground', '--secondary'],
      ['selected label on its fill', '--selected-foreground', '--selected'],
    ]

    for (const [name, fg, bg] of cases) {
      it(name, () => {
        expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
      })
    }
  })

  describe('control boundaries meet 1.4.11 (3:1)', () => {
    // Every surface a form field actually sits on. The old #C9D3E0 was 1.51:1
    // on the card; restoring it turns all three of these red.
    for (const surface of ['--card', '--background', '--muted']) {
      it(`field border on ${surface}`, () => {
        expect(contrastRatio(token('--input'), token(surface))).toBeGreaterThanOrEqual(3)
      })
    }

    it('the focus ring is visible on the card', () => {
      // `focus-visible:border-ring` draws the focused border at full strength,
      // so this is the ratio that carries focus.
      expect(contrastRatio(token('--ring'), token('--card'))).toBeGreaterThanOrEqual(3)
    })

    it('the selection marker is visible on its fill', () => {
      expect(contrastRatio(token('--selected-border'), token('--selected'))).toBeGreaterThanOrEqual(3)
    })
  })

  it('keeps the page and the card distinguishable', () => {
    // A long form is read as cards on a ground; identical values would flatten
    // it, which is the defect Wave 1 found in the admin theme.
    expect(token('--background').toLowerCase()).not.toBe(token('--card').toLowerCase())
  })
})
