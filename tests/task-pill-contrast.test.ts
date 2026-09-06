import { describe, expect, it } from 'vitest'
import { TASK_SOURCES, TASK_SOURCE_LABEL, TASK_SOURCE_PILL, type TaskSource } from '@/lib/tasks/types'
import { allThemeCssVars, themes } from '@/lib/theme/tokens'
import { contrastRatio, parseColor } from '@/lib/theme/contrast'

/**
 * The Plan pill on the task queue was light grey text on a light grey chip —
 * 1.15:1, which is not "low contrast", it is invisible. It read `text-accent`,
 * and `--accent` is a *surface* token: the colour a row goes when you hover it.
 * The zinc retheme collapsed both it and `--teal-bg` to near-identical greys and
 * nothing caught it, because the theme's contrast pairs are documented as
 * "must meet WCAG AA" with nothing anywhere that checks them.
 *
 * These tests read the pills' own Tailwind classes, so a pill added later is
 * covered without anyone remembering to list it here.
 */

/** AA for text below 18pt. The pills are 10px, so the large-text 3:1 allowance
 *  does not apply to them. */
const AA = 4.5

/** `bg-stage-work-bg` → `--stage-work-bg`, `text-blue` → `--blue`. */
function tokenFor(classes: string, prefix: 'bg' | 'text'): string {
  const match = classes.split(/\s+/).find(name => name.startsWith(`${prefix}-`))
  if (!match) throw new Error(`No ${prefix}- class in "${classes}"`)
  return `--${match.slice(prefix.length + 1)}`
}

const THEME_IDS = ['light', 'dark'] as const

function ratioFor(source: TaskSource, theme: (typeof THEME_IDS)[number]): number {
  const vars = allThemeCssVars(themes[theme])
  const classes = TASK_SOURCE_PILL[source]
  const foreground = vars[tokenFor(classes, 'text')]
  const background = vars[tokenFor(classes, 'bg')]
  expect(foreground, `${theme} ${source} foreground token`).toBeTruthy()
  expect(background, `${theme} ${source} background token`).toBeTruthy()
  return contrastRatio(foreground, background)
}

describe('every task source pill is readable', () => {
  it.each(THEME_IDS.flatMap(theme => TASK_SOURCES.map(source => [theme, source] as const)))(
    '%s: %s',
    (theme, source) => {
      expect(ratioFor(source, theme)).toBeGreaterThanOrEqual(AA)
    },
  )

  it('never pairs a chip with a surface token for its text', () => {
    // The specific mistake: `--accent`, `--muted`, `--background`, `--card` and
    // friends are what things sit *on*, not what text is drawn in. The one
    // legitimate use of a surface name here is `bg-muted`, as a background.
    const SURFACE_ONLY = ['accent', 'background', 'card', 'popover', 'secondary', 'primary', 'muted']
    for (const source of TASK_SOURCES) {
      const text = tokenFor(TASK_SOURCE_PILL[source], 'text').slice(2)
      expect(SURFACE_ONLY, `${source} pill text`).not.toContain(text)
    }
  })

  it('gives the Plan pill a hue of its own, not another pill’s', () => {
    // Plan is the highest-volume source in the queue; if it matched Manual's
    // neutral chip the pill would stop carrying any information at all.
    const others = TASK_SOURCES.filter(s => s !== 'sla').map(s => TASK_SOURCE_PILL[s])
    expect(others).not.toContain(TASK_SOURCE_PILL.sla)
  })

  /**
   * The gap that let a whole feature ship unlabelled: `'prompt'` was added to
   * the database's `tasks_source_check` and never to `TASK_SOURCES`, so both
   * maps returned `undefined` for it and `TaskSourcePill` rendered an empty
   * chip. The contrast cases above iterate `TASK_SOURCES` and so could not
   * see a source the union did not know about. This checks the maps are total
   * against the union, which is the assertion that would have caught it.
   */
  it('has a label and a pill for every source, with no blanks', () => {
    for (const source of TASK_SOURCES) {
      expect(TASK_SOURCE_LABEL[source], `${source} label`).toBeTruthy()
      expect(TASK_SOURCE_PILL[source], `${source} pill`).toBeTruthy()
    }
  })

  it('knows about tasks a prompt run created', () => {
    expect(TASK_SOURCES).toContain('prompt')
  })
})

describe('the contrast helper the pills are measured with', () => {
  it('agrees with the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#065f46', '#ecfdf5')).toBeCloseTo(contrastRatio('#ecfdf5', '#065f46'), 10)
  })

  it('resolves oklch, which is the only form the dark theme states', () => {
    // oklch(0 0 0) and oklch(1 0 0) are black and white by definition.
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 1)
    expect(parseColor('oklch(0.68 0.14 155)')).not.toBeNull()
  })

  it('puts an oklch hue where the hue says, not 57 degrees off', () => {
    // Contrast is driven by lightness, so a hue bug in the converter — degrees
    // fed to Math.cos, which wants radians — moves no ratio enough to fail.
    // Checking which channel dominates catches it without a reference table.
    const channels = (value: string) => parseColor(value) as [number, number, number]
    const [redR, redG, redB] = channels('oklch(0.6 0.2 30)')
    expect(redR).toBeGreaterThan(redG)
    expect(redG).toBeGreaterThan(redB)

    const [greenR, greenG, greenB] = channels('oklch(0.6 0.2 145)')
    expect(greenG).toBeGreaterThan(greenR)
    expect(greenG).toBeGreaterThan(greenB)

    const [blueR, blueG, blueB] = channels('oklch(0.6 0.2 265)')
    expect(blueB).toBeGreaterThan(blueR)
    expect(blueB).toBeGreaterThan(blueG)
  })

  it('refuses a colour it cannot read rather than scoring it', () => {
    // A silently skipped pair is how the unreadable pill survived this long.
    expect(() => contrastRatio('var(--nope)', '#ffffff')).toThrow(/Unparseable/)
  })
})
