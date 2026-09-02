import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const here = path.resolve(__dirname, '..')

/**
 * Next resolves the `proxy.ts` convention file by walking up from the app
 * directory. Delete this app's copy and the build still succeeds — it just
 * quietly uses the root app's proxy instead, applying that app's role routing
 * and redirects to a codebase that has neither. This pins the shadow.
 */
describe('workbench proxy isolation', () => {
  it('has its own proxy.ts so it cannot inherit the root app\'s', () => {
    const local = path.join(here, 'proxy.ts')
    expect(fs.existsSync(local)).toBe(true)
    expect(fs.readFileSync(local, 'utf8')).toMatch(/export function proxy\b/)
  })

  it('does not import anything from the root app', () => {
    // A relative climb out of apps/workbench would reintroduce the coupling
    // this app exists to avoid, and would not survive the old app's deletion.
    const files = fs
      .readdirSync(here, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath ?? here, entry.name))
      .filter((file) => !file.includes('node_modules') && !file.includes('.next'))

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/from '\.\.\/\.\.\/(?!\.)/)
    }
  })
})
