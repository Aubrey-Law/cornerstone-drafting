import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The client-facing palette must not silently follow the admin theme.
 *
 * `.guided-interview` and `.client-booking` pin their own light palette in
 * app/globals.css so the zinc retheme doesn't reach clients. The pin is a list
 * of CSS variables, and a variable that isn't in the list falls through to the
 * admin theme — so when someone adds a colour token to the theme and uses it in
 * a client component, the client surface quietly changes. This asserts the pin
 * covers every core semantic token the theme defines, read out of the CSS (not
 * restated here), so a gap shows up as a failing test instead of a visual diff.
 *
 * Contrast of the pinned values is measured separately in
 * intake-palette-contrast.test.ts.
 */

const ROOT = join(__dirname, '..')
const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
const generated = readFileSync(join(ROOT, 'packages/ui/styles/theme/generated.css'), 'utf8')

function declaredIn(css: string, selectorStart: string): Set<string> {
  const start = css.indexOf(selectorStart)
  if (start === -1) throw new Error(`Selector not found: ${selectorStart}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  if (open === -1 || close === -1) throw new Error(`Unterminated block: ${selectorStart}`)
  const out = new Set<string>()
  for (const line of css.slice(open + 1, close).split('\n')) {
    const match = line.replace(/\/\*.*?\*\//g, '').match(/^\s*(--[\w-]+)\s*:/)
    if (match) out.add(match[1])
  }
  return out
}

/** The theme's shadcn-style semantic colour set — what Tailwind's bg-card, text-muted-foreground etc. resolve to. */
const CORE_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--border',
  '--input',
  '--ring',
] as const

const lightTheme = declaredIn(generated, ':root,')

const interview = declaredIn(globals, ':root:not(.dark) .guided-interview:not(.guided-zinc),')
const booking = declaredIn(globals, ':root:not(.dark) .client-booking,')

/**
 * Core tokens the booking card deliberately leaves to the app theme: it renders
 * no popover, secondary or accent surface, and no destructive state. Adding a
 * token here is a decision to let it follow the admin theme — say why.
 */
const BOOKING_FOLLOWS_THEME: ReadonlySet<string> = new Set([
  '--popover',
  '--popover-foreground',
  '--secondary',
  '--secondary-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
])

describe('client palette pins track the theme', () => {
  it('sanity: the theme defines every core token this test checks', () => {
    // If the generator renames one, the checks below would pass vacuously.
    for (const token of CORE_TOKENS) expect(lightTheme.has(token), token).toBe(true)
  })

  it('.guided-interview pins every core token', () => {
    const unpinned = CORE_TOKENS.filter(token => !interview.has(token))
    expect(unpinned).toEqual([])
  })

  it('.client-booking pins every core token except the documented ones', () => {
    const unpinned = CORE_TOKENS.filter(token => !booking.has(token) && !BOOKING_FOLLOWS_THEME.has(token))
    expect(unpinned).toEqual([])
  })

  it('the booking allow-list holds no stale entries', () => {
    // An entry that got pinned later should leave the list, or it stops meaning anything.
    const stale = [...BOOKING_FOLLOWS_THEME].filter(token => booking.has(token))
    expect(stale).toEqual([])
  })
})
