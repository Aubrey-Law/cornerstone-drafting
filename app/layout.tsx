import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { THEME_INIT_SCRIPT } from '@/lib/theme/theme-init-script'
import './globals.css'

// Vendored latin-subset variable fonts (assets/fonts/) so production builds
// don't reach Google's network. Latin-ext glyphs fall back to system fonts.
// Outfit is the app-wide UI face; DM Sans stays on --font-sans because the
// guided interview (client intake) pins its typography to that variable.
const outfit = localFont({
  src: '../assets/fonts/outfit-latin-var.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-outfit',
})

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

const ebGaramond = localFont({
  src: '../assets/fonts/eb-garamond-latin-var.woff2',
  weight: '400 800',
  display: 'swap',
  variable: '--font-eb-garamond',
})

// The firm wordmark's face (AUBREY LAW on the client booking pages). Static
// 400 only, and not preloaded: only the booking card uses it, so other pages
// shouldn't pay for the download.
const cormorantSc = localFont({
  src: '../assets/fonts/cormorant-sc-latin-400.woff2',
  weight: '400',
  display: 'swap',
  preload: false,
  variable: '--font-cormorant-sc',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export const metadata: Metadata = {
  title: 'Cornerstone Drafting',
  description: 'Estate planning document drafting workspace',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${outfit.variable} ${dmSans.variable} ${lora.variable} ${ebGaramond.variable} ${cormorantSc.variable}`} suppressHydrationWarning>
      <head>
        {/* Optional: restores saved light/dark on admin; system mode uses CSS prefers-color-scheme */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
