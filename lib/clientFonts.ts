import localFont from 'next/font/local'

/**
 * Faces only the client-facing surfaces use, kept out of the root layout so
 * admin routes don't preload ~100 KB they never draw. A font is preloaded on a
 * route when the module that creates it is in that route's import graph, and
 * its CSS variable is only defined where the class below is applied — so each
 * consumer puts the class on its own `client-root` / `guided-interview`
 * element rather than on <html>. (That also covers Radix portals, which render
 * into <body> outside any layout wrapper: they carry the class themselves.)
 *
 * Latin-subset variable fonts vendored in assets/fonts/ so production builds
 * don't reach Google's network.
 */

// DM Sans stays on `--font-sans` because the guided interview (client intake)
// pins its typography to that variable through `--gi-sans`. The rest of the app
// is Outfit; the Tailwind bridge's own `--font-sans` sits in a CSS layer, so
// this unlayered declaration wins on the elements that carry it.
const dmSans = localFont({
  src: '../assets/fonts/dm-sans-latin-var.woff2',
  weight: '100 1000',
  display: 'swap',
  variable: '--font-sans',
})

// Exposed as `--font-lora`, not `--font-serif`: the Tailwind theme bridge
// (styles/theme/tailwind-bridge.css) maps `--font-serif` to the sans stack, so
// anything injected under that name is shadowed and never renders.
const lora = localFont({
  src: '../assets/fonts/lora-latin-var.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-lora',
})

/** For `.client-root`: the serif that h1–h3 use on the client path. */
export const clientSerifClass = lora.variable

/** For `.guided-interview`: DM Sans for the interview, plus the serif its headings use. */
export const guidedFontClass = `${dmSans.variable} ${lora.variable}`
