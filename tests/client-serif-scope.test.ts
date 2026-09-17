import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The serif on client-facing headings, and the line it must not cross.
 *
 * It is opt-in through `.client-root` rather than a global default with an
 * admin exception, and that is the part worth guarding: Radix portals dialogs
 * to <body>, outside `.admin-root`, so a global default would put a serif on
 * every admin dialog title while `.admin-root h1 { sans }` sat there looking
 * like it had covered the case.
 */

const ROOT = join(__dirname, '..')
const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')

/** Files carrying the class, by repository-relative path. */
function filesWithClientRoot(): string[] {
  const out = execFileSync(
    'git',
    ['grep', '-l', 'client-root', '--', 'app', 'components'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out.split('\n').filter(Boolean)
}

describe('client serif scope', () => {
  it('applies the serif only inside an opted-in scope', () => {
    const rule = globals.match(/^\s*\.client-root :is\(h1, h2, h3\),\n\s*\.guided-interview:not\(\.guided-zinc\) :is\(h1, h2, h3\) \{\n([^}]*)\}/m)
    expect(rule, 'the scoped serif rule should exist in globals.css').not.toBeNull()
    expect(rule?.[1]).toContain('--font-lora')
  })

  it('never sets the serif on a bare heading selector', () => {
    // A global `h1 { serif }` would reach admin dialog titles through the
    // portal. Rather than pattern-matching for that one shape, this asserts the
    // property directly: every rule that reaches for Lora is scoped. Comments
    // are stripped first — the first draft of this test matched its own prose.
    const css = globals.replace(/\/\*[\s\S]*?\*\//g, '')
    const unscoped = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => body.includes('--font-lora'))
      .map(([, selector]) => selector.trim())
      .filter(selector => !/\.client-root|\.guided-interview/.test(selector))

    expect(unscoped, 'every --font-lora rule should be scoped to a client surface').toEqual([])
  })

  it('reuses a font that is already vendored', () => {
    // Lora is loaded in app/layout.tsx and already carried the portal
    // dashboard's heading, so this costs no new bytes over the wire.
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8')
    expect(layout).toContain('--font-lora')
    expect(globals).not.toMatch(/@import url\(.*fonts\.googleapis/)
  })

  it('covers every client-facing surface', () => {
    const scoped = filesWithClientRoot()
    for (const surface of [
      'components/layout/AuthShell.tsx', // login, password reset, intake start
      'app/(portal)/PortalShell.tsx',
      'app/book/[slug]/page.tsx',
      'app/book/manage/[token]/page.tsx',
      'components/esign/SigningExperience.tsx',
    ]) {
      expect(scoped, `${surface} should carry client-root`).toContain(surface)
    }
  })

  it('leaves the admin app alone', () => {
    const inAdmin = filesWithClientRoot().filter(
      file => file.startsWith('app/admin/') || file.startsWith('components/rail/'),
    )
    expect(inAdmin).toEqual([])
  })

  it('excludes the drafting surfaces that reuse the interview markup', () => {
    // `.guided-zinc` is the attorney-facing design sheet and drafting steps.
    // They share `.guided-interview` with the client intake and must not
    // inherit its serif.
    expect(globals).toContain('.guided-interview:not(.guided-zinc) :is(h1, h2, h3)')
  })

  it('leaves body text and form controls sans', () => {
    // guided.css pins the sans on inputs, selects and comboboxes; the serif
    // rule names only h1-h3, so nothing a person types into changes face.
    const guided = readFileSync(join(ROOT, 'app/intake/guided.css'), 'utf8')
    expect(guided).toContain('font-family: var(--gi-sans)')
    expect(globals).not.toMatch(/\.client-root\s+(body|input|button|p)\b[^{]*\{[^}]*--font-lora/)
  })
})
