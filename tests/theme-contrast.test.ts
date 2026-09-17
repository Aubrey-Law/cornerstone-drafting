import { describe, expect, it } from 'vitest'
import {
  allThemeCssVars,
  contrastPairs,
  statusContrastPairs,
  themes,
  uiContrastPairs,
  type ThemeDefinition,
  type ThemePair,
} from '@/lib/theme/tokens'
import { contrastRatio } from '@/lib/theme/contrast'

/**
 * The theme's own colour pairs, measured.
 *
 * `contrastPairs` and `statusContrastPairs` had carried the comment "must meet
 * WCAG AA (4.5:1)" since they were written with nothing anywhere that checked
 * them, and `contrastPairs` named nine pairs out of the dozens the themes
 * declare. An audit of all of them found seven misses, every one of them in a
 * pair nobody had listed: the dark destructive, warning and info labels at
 * 2.89:1, 3.58:1 and 3.75:1; the dark secondary button at 3.81:1; muted text on
 * the sidebar and on `bg-muted` at 4.32:1 and 4.35:1, drawn at 10px and 11px;
 * and `--card` identical to `--background` in both themes, which left every
 * card in the app bounded by a 1.27:1 hairline and nothing else.
 *
 * tests/task-pill-contrast.test.ts does this for the task queue's pills, and it
 * is the reason those are readable. This is the same guard for the theme those
 * pills are drawn from.
 */

/** AA for text below 18pt. The app draws its muted text at 10px and 11px, so
 *  the large-text 3:1 allowance never applies to anything measured here. */
const AA = 4.5

/** WCAG 1.4.11 Non-text Contrast, for boundaries that identify a control. */
const NON_TEXT = 3

function ratioFor(pair: ThemePair): number {
  const theme: ThemeDefinition = themes[pair.theme]
  return contrastRatio(pair.foreground(theme), pair.background(theme))
}

describe('every declared text pair meets AA', () => {
  it.each(contrastPairs.map(pair => [`${pair.theme}: ${pair.name}`, pair] as const))(
    '%s',
    (_label, pair) => {
      expect(ratioFor(pair)).toBeGreaterThanOrEqual(AA)
    },
  )
})

describe('every status badge meets AA', () => {
  it.each(statusContrastPairs.map(pair => [`${pair.theme}: ${pair.name}`, pair] as const))(
    '%s',
    (_label, pair) => {
      const vars = allThemeCssVars(themes[pair.theme])
      const foreground = vars[pair.foregroundKey]
      const background = vars[pair.backgroundKey]
      expect(foreground, `${pair.theme} ${pair.name} ${pair.foregroundKey}`).toBeTruthy()
      expect(background, `${pair.theme} ${pair.name} ${pair.backgroundKey}`).toBeTruthy()
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA)
    },
  )
})

describe('every control boundary meets 1.4.11', () => {
  it.each(uiContrastPairs.map(pair => [`${pair.theme}: ${pair.name}`, pair] as const))(
    '%s',
    (_label, pair) => {
      expect(ratioFor(pair)).toBeGreaterThanOrEqual(NON_TEXT)
    },
  )
})

describe('the surfaces are actually distinct', () => {
  /**
   * The finding this file exists for. `--card` and `--background` were the same
   * hex in both themes — 1.00:1 — so 180 hand-rolled card containers were drawn
   * on a page the same colour as themselves.
   *
   * This is deliberately an inequality and not a ratio. Near black no two dark
   * greys reach even 1.2:1, so a threshold that a dark card could pass would be
   * one a light card passes while invisible. What a card needs is a step in one
   * direction; the contrast obligation lives on `border.input` above.
   */
  it.each(['light', 'dark'] as const)('%s: a card is not the page it sits on', themeId => {
    const { bg } = themes[themeId].semantic
    expect(bg.elevated, `${themeId} elevated vs canvas`).not.toBe(bg.canvas)
  })

  it.each(['light', 'dark'] as const)('%s: a muted fill is not the card it sits on', themeId => {
    const { bg } = themes[themeId].semantic
    expect(bg.muted, `${themeId} muted vs elevated`).not.toBe(bg.elevated)
  })

  /** A row hover that matches the card underneath is not a hover. */
  it.each(['light', 'dark'] as const)('%s: the hover surface is not the card', themeId => {
    const { bg, interactive } = themes[themeId].semantic
    expect(interactive.accent, `${themeId} accent vs elevated`).not.toBe(bg.elevated)
  })
})

describe('the brand tokens name colours, not neutrals', () => {
  /**
   * `brand.navy` and `brand.teal` were pointed at `#18181b` and `#09090b` by
   * the zinc retheme and kept their names, so `text-brand-teal` in the invoice
   * preview drew near-black and nobody could see that it had stopped meaning
   * anything. A neutral is a colour whose channels are within a few points of
   * each other; the firm's navy and teal are not.
   */
  function isNeutral(hex: string): boolean {
    const value = hex.trim().replace('#', '')
    if (!/^[0-9a-f]{6}$/i.test(value)) return false
    const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16))
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12
  }

  it.each(['light', 'dark'] as const)('%s: brand navy is a navy', themeId => {
    expect(isNeutral(themes[themeId].semantic.brand.navy), themes[themeId].semantic.brand.navy).toBe(false)
  })

  it.each(['light', 'dark'] as const)('%s: brand teal is a teal', themeId => {
    expect(isNeutral(themes[themeId].semantic.brand.teal), themes[themeId].semantic.brand.teal).toBe(false)
  })

  it('agrees with the mark in public/aubrey-law-logo.svg', () => {
    // The logo is the only source of truth for these two, and the retheme drifted
    // from it silently. If the mark changes, this is where it gets noticed.
    expect(themes.light.semantic.brand.navy.toLowerCase()).toBe('#1f2d5a')
    expect(themes.light.semantic.brand.teal.toLowerCase()).toBe('#1a6b72')
  })
})

describe('both themes declare the same keys', () => {
  /** A token added to one theme and forgotten in the other resolves to nothing
   *  in the theme that lacks it, and the surface using it goes transparent. */
  it('has no key in one theme that the other is missing', () => {
    const light = Object.keys(allThemeCssVars(themes.light)).sort()
    const dark = Object.keys(allThemeCssVars(themes.dark)).sort()
    expect(dark).toEqual(light)
  })

  it('states every declared pair against both themes', () => {
    for (const pairs of [contrastPairs, uiContrastPairs]) {
      const byName = new Map<string, Set<string>>()
      for (const pair of pairs) {
        const seen = byName.get(pair.name) ?? new Set<string>()
        seen.add(pair.theme)
        byName.set(pair.name, seen)
      }
      for (const [name, seen] of byName) {
        expect([...seen].sort(), `${name} is only declared for one theme`).toEqual(['dark', 'light'])
      }
    }
  })
})
