import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Next's SWC JSX transform drops the leading space of a text run that follows a
 * closing tag when that run contains an HTML entity — `<strong>Off</strong> by
 * you&apos;ve` rendered "Offby". Vitest compiles with esbuild, which keeps the
 * space, so no render test catches it. Write `</strong>{' '}by` instead.
 */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

describe('JSX text after a closing tag', () => {
  it('never relies on a bare leading space when the text holds an HTML entity', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<\/[A-Za-z][\w.]*>( [^<{}]*)/g)) {
        const text = match[1]
        if (text.trim() && /&[a-zA-Z]+;|&#\d+;/.test(text)) {
          const line = source.slice(0, match.index).split('\n').length
          offenders.push(`${file}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
