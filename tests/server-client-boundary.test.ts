import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A server component may import a client *component* to render it, but it can
 * never call a plain function out of a `'use client'` module: the bundler hands
 * back a client reference, and invoking it during the server render throws at
 * runtime — the page just fails with the error boundary.
 *
 * Components are PascalCase and types are erased, so a camelCase value import
 * from a client module is the tell.
 */

const APP_ROOT = path.join(process.cwd(), 'app')
const REPO_ROOT = process.cwd()

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function isClientModule(file: string): boolean {
  const source = fs.readFileSync(file, 'utf-8')
  return /^\s*(['"])use client\1/m.test(source.slice(0, 200))
}

/** Resolve an `@/...` specifier to a file on disk, if it is one of ours. */
function resolveLocal(spec: string): string | null {
  if (!spec.startsWith('@/')) return null
  const base = path.join(REPO_ROOT, spec.slice(2))
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

interface Violation {
  from: string
  imports: string
  binding: string
}

function rel(p: string) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/')
}

describe('server/client boundary', () => {
  const serverFiles = walk(APP_ROOT).filter(file => !isClientModule(file))

  it('finds server components to check', () => {
    expect(serverFiles.length).toBeGreaterThan(10)
  })

  it('never calls a non-component export out of a "use client" module', () => {
    const violations: Violation[] = []

    for (const file of serverFiles) {
      const source = fs.readFileSync(file, 'utf-8')
      const importRe = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g

      for (const match of source.matchAll(importRe)) {
        const [, typeOnly, clause, spec] = match
        if (typeOnly) continue

        const target = resolveLocal(spec)
        if (!target || !isClientModule(target)) continue

        for (const raw of clause.split(',')) {
          const binding = raw.trim()
          if (!binding || binding.startsWith('type ')) continue
          const name = (binding.split(/\s+as\s+/).pop() ?? binding).trim()
          // PascalCase is a component, which a server file may render.
          if (/^[A-Z]/.test(name)) continue
          violations.push({ from: rel(file), imports: spec, binding: name })
        }
      }
    }

    expect(violations).toEqual([])
  })
})
