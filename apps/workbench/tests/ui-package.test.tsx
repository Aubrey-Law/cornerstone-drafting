// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { Button } from '@aubrey-law/ui/button'
import nextConfig from '../next.config'

const here = path.resolve(__dirname, '..')

/**
 * The workbench renders the same design system as the root app, from the same
 * source. A primitive resolves through the package, Tailwind is told where the
 * package's class names live, and the theme tokens come from the package too.
 */
describe('workbench uses @aubrey-law/ui', () => {
  it('renders a primitive from the package', () => {
    render(<Button>Open matter</Button>)
    const button = screen.getByRole('button', { name: 'Open matter' })
    expect(button.getAttribute('data-slot')).toBe('button')
    expect(button.className).toMatch(/inline-flex/)
  })

  it('wires Tailwind to the package: theme import and @source', () => {
    const css = fs.readFileSync(path.join(here, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/@import ['"]tailwindcss['"]/)
    expect(css).toMatch(/@import ['"]@aubrey-law\/ui\/styles\/theme\/index\.css['"]/)
    // Tailwind v4 only scans the app's own directory; without this the
    // package's utilities are never generated and every primitive renders bare.
    expect(css).toMatch(/@source ['"][^'"]*packages\/ui\/src['"]/)
    expect(fs.existsSync(path.join(here, 'postcss.config.mjs'))).toBe(true)
    expect(fs.readFileSync(path.join(here, 'app/layout.tsx'), 'utf8')).toMatch(/import '\.\/globals\.css'/)
  })

  it('transpiles the package', () => {
    expect(nextConfig.transpilePackages).toContain('@aubrey-law/ui')
  })
})
