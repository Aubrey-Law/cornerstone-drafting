import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { contrastRatio, parseColor } from '@/lib/theme/contrast'

/**
 * The focus indicator, measured.
 *
 * Controls draw focus as a 3px halo of `--ring` at some opacity, and most also
 * switch their border to the full `--ring`. The full colour was never in doubt
 * (8–15:1 on every surface), but the halo is what a filled button or a bare
 * `drag-resize` handle shows on its own, and at the shadcn default of 50% it
 * came out at 2.97:1 on the light canvas, 2.91:1 on `muted` and 2.83:1 on
 * `accent` — just under the 3:1 WCAG 1.4.11 asks of a focus indicator.
 *
 * The threshold is derived here from the theme's real tokens rather than
 * restated, so changing `--ring` or a surface moves the bar with it.
 */

const ROOT = join(__dirname, '..')
const generated = readFileSync(join(ROOT, 'packages/ui/styles/theme/generated.css'), 'utf8')

/** Declarations of one theme block in generated.css, by the selector that opens it. */
function themeBlock(selectorStart: string): Record<string, string> {
  const start = generated.indexOf(selectorStart)
  if (start === -1) throw new Error(`Selector not found: ${selectorStart}`)
  const open = generated.indexOf('{', start)
  const close = generated.indexOf('\n  }', open)
  const out: Record<string, string> = {}
  for (const match of generated.slice(open, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim()
  }
  return out
}

const themes = {
  light: themeBlock(':root,'),
  dark: themeBlock('.dark,'),
}

/** Surfaces a focus ring is drawn over. */
const SURFACES = ['--background', '--card', '--muted', '--popover', '--sidebar', '--accent'] as const

function toHex([r, g, b]: [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `--ring` at `alpha` (0–1) composited over `surface`, as an opaque colour. */
function halo(ring: string, surface: string, alpha: number): string {
  const fg = parseColor(ring)
  const bg = parseColor(surface)
  if (!fg || !bg) throw new Error(`Unparseable: ${ring} / ${surface}`)
  return toHex([0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha)) as [number, number, number])
}

/** Weakest contrast of the halo against the surface it sits on, across both themes. */
function worstHalo(alphaPercent: number): { ratio: number; where: string } {
  let worst = { ratio: Infinity, where: '' }
  for (const [name, tokens] of Object.entries(themes)) {
    for (const surface of SURFACES) {
      const colour = tokens[surface]
      if (!colour) continue
      const ratio = contrastRatio(halo(tokens['--ring'], colour, alphaPercent / 100), colour)
      if (ratio < worst.ratio) worst = { ratio, where: `${name} ${surface} ${colour}` }
    }
  }
  return worst
}

/** Every opacity written after `ring-ring/` in a component or primitive. */
function haloUsages(): Array<{ file: string; alpha: number }> {
  const out = execFileSync('git', ['grep', '-nE', 'ring-ring/[0-9]+', '--', 'app', 'components', 'packages/ui/src'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      const file = line.split(':')[0]
      return [...line.matchAll(/ring-ring\/(\d+)/g)].map(m => ({ file, alpha: Number(m[1]) }))
    })
}

describe('focus ring contrast', () => {
  it('the full-strength ring clears 3:1 on every surface in both themes', () => {
    for (const [name, tokens] of Object.entries(themes)) {
      for (const surface of SURFACES) {
        if (!tokens[surface]) continue
        const ratio = contrastRatio(tokens['--ring'], tokens[surface])
        expect(ratio, `${name} ring on ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('the weakest halo still in use clears 3:1 on every surface', () => {
    const usages = haloUsages()
    expect(usages.length).toBeGreaterThan(0)
    const weakest = Math.min(...usages.map(u => u.alpha))
    const { ratio, where } = worstHalo(weakest)
    expect(ratio, `ring-ring/${weakest} over ${where}`).toBeGreaterThanOrEqual(3)
  })

  it('no control uses a halo weaker than the measured floor', () => {
    // Smallest whole-5% opacity that clears 3:1 everywhere.
    let floor = 5
    while (floor < 100 && worstHalo(floor).ratio < 3) floor += 5
    const weak = haloUsages().filter(u => u.alpha < floor)
    expect(weak, `halos below ${floor}%`).toEqual([])
  })
})
