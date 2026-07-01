#!/usr/bin/env npx tsx
/**
 * Generates styles/theme/generated.css from lib/theme/tokens.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allThemeCssVars, themes } from '../lib/theme/tokens'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function declBlock(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')
}

function main() {
  const light = allThemeCssVars(themes.light)
  const dark = allThemeCssVars(themes.dark)

  const css = `/* AUTO-GENERATED — do not edit. Run: npm run theme:generate */
/* Source: lib/theme/tokens.ts */

@layer theme-tokens {
  /**
   * Light theme (default).
   * Selectors: :root, .light, [data-theme="light"]
   */
  :root,
  .light,
  [data-theme="light"] {
    color-scheme: light;
${declBlock(light)}
  }

  /**
   * Dark theme — explicit class/attribute override.
   * Selectors: .dark, [data-theme="dark"]
   */
  .dark,
  [data-theme="dark"] {
    color-scheme: dark;
${declBlock(dark)}
  }

  /**
   * System dark preference when no explicit light theme is set.
   * Works without JavaScript on first paint.
   */
  @media (prefers-color-scheme: dark) {
    :root:not(.light):not([data-theme="light"]) {
      color-scheme: dark;
${declBlock(dark)}
    }
  }
}
`

  const outDir = join(root, 'styles/theme')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'generated.css')
  writeFileSync(outPath, css, 'utf8')
  console.log(`Wrote ${outPath}`)
}

main()
