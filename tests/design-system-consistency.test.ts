import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8')

describe('vendored fonts', () => {
  it('loads all three fonts locally instead of from Google', () => {
    const layout = read('app/layout.tsx')
    expect(layout).not.toContain('next/font/google')
    expect(layout).toContain("next/font/local")
    for (const file of [
      'assets/fonts/dm-sans-latin-var.woff2',
      'assets/fonts/lora-latin-var.woff2',
      'assets/fonts/eb-garamond-latin-var.woff2',
      'assets/fonts/cormorant-sc-latin-400.woff2',
    ]) {
      expect(existsSync(path.join(root, file)), `${file} missing`).toBe(true)
      expect(layout).toContain(file.replace('assets/', '../assets/'))
    }
    // The CSS variable contract other styles depend on must survive the swap.
    for (const variable of ['--font-sans', '--font-lora', '--font-eb-garamond', '--font-cormorant-sc']) {
      expect(layout).toContain(variable)
    }
  })
})

describe('engagement + intake controls stay on shadcn primitives', () => {
  // Migrated during the design-system consolidation; raw form elements should
  // not creep back in. IntakeFormPrimitives' native <select> is a deliberate
  // exception (platform picker on mobile), styled with Input's tokens.
  const files = [
    'components/engagement/EngagementWorkspace.tsx',
    'components/engagement/EngagementClauseEditor.tsx',
    'components/intake/IntakeFormPrimitives.tsx',
  ]

  for (const file of files) {
    it(`${file} has no raw <input>/<textarea> elements`, () => {
      const source = read(file)
      expect(source).not.toMatch(/<input[\s>]/)
      expect(source).not.toMatch(/<textarea[\s>]/)
    })
  }

  it('IntakeWizard has no raw textareas or hard-coded input chrome', () => {
    const source = read('components/intake/IntakeWizard.tsx')
    expect(source).not.toMatch(/<textarea[\s>]/)
    expect(source).not.toMatch(/border-gray-\d+ px-3 py-2/)
  })

  // Migrated from an inline-style parallel styling system; keep it on
  // Tailwind tokens + shadcn primitives. (GuidedInterview is a deliberate
  // exception: its inline styles reference the scoped --gi-* token system in
  // app/intake/guided.css from the guided-interview design handoff.)
  it('AdminIntakeSheet stays free of inline styles and raw controls', () => {
    const source = read('components/AdminIntakeSheet.tsx')
    expect(source).not.toMatch(/style=\{/)
    expect(source).not.toMatch(/<input[\s>]/)
    expect(source).not.toMatch(/<textarea[\s>]/)
    expect(source).not.toContain('React.CSSProperties')
  })
})
