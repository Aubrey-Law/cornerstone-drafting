import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * jsdom must never reach a Vercel lambda.
 *
 * `isomorphic-dompurify` does a top-level `require('jsdom')`, and jsdom's
 * `html-encoding-sniffer` requires an ESM file, so the function dies at load
 * with ERR_REQUIRE_ESM — taking out every route whose module graph reaches it
 * (that was /admin/inbox, /admin/contacts and /admin/drafting, all 500ing).
 *
 * This has now bitten twice: once in the email pipeline, worked around in
 * lib/email/templateShared.ts, and again via the rich-text editor. These are
 * static guards so it can't come back a third time.
 */

const ROOT = process.cwd()
const BANNED = ['isomorphic-dompurify', 'jsdom']
const SOURCE_DIRS = ['app', 'lib', 'components']

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(abs)
  return out
}

/** Comments legitimately name these packages when explaining why to avoid them. */
function stripComments(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function importsPackage(contents: string, pkg: string): boolean {
  const escaped = pkg.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')
  return new RegExp(
    `(?:from\\s*|require\\(\\s*|import\\(\\s*)['"]${escaped}(?:/[^'"]*)?['"]`,
  ).test(stripComments(contents))
}

describe('jsdom stays out of the server bundle', () => {
  it('is not a production dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const deps = Object.keys(pkg.dependencies ?? {})
    for (const banned of BANNED) {
      expect(deps, `${banned} must stay out of "dependencies"`).not.toContain(banned)
    }
  })

  it('keeps dompurify available for the editor to sanitize with', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.dompurify).toBeTruthy()
  })

  it('is imported by no application source file', () => {
    const offenders: string[] = []
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(dir)) {
        const contents = fs.readFileSync(file, 'utf8')
        for (const banned of BANNED) {
          if (importsPackage(contents, banned)) {
            offenders.push(`${path.relative(ROOT, file)} imports ${banned}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('sanitizes without a DOM rather than throwing', () => {
    // The editor renders during SSR even though it is a client component, so
    // its sanitize() has to survive there.
    const editor = fs.readFileSync(
      path.join(ROOT, 'components/admin/RichTextEmailEditor.tsx'), 'utf8',
    )
    expect(editor).toMatch(/typeof window === 'undefined' \|\| !DOMPurify\.isSupported/)
    expect(editor).toMatch(/sanitizeEmailHtml/)
  })
})
