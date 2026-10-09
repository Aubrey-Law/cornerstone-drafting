import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { ThemedToaster } from '@/components/ThemedToaster'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { THEME_INIT_SCRIPT } from '@/lib/theme/theme-init-script'
import { SettingsHistoryBoundary } from './admin/settings/SettingsHistoryBoundary'
import './globals.css'

// Vendored latin-subset variable fonts (assets/fonts/) so production builds
// don't reach Google's network. Latin-ext glyphs fall back to system fonts.
// Outfit is the app-wide UI face. DM Sans (the client intake) and Lora (client
// headings) live in lib/clientFonts.ts so admin routes don't preload them.
const outfit = localFont({
  src: '../assets/fonts/outfit-latin-var.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-outfit',
})

// Not preloaded: only the booking card and the design-sheet clause preview use
// it, so every other route (all of admin, the portal, intake) shouldn't pay a
// preload for it. The @font-face is still emitted, so it loads on demand.
const ebGaramond = localFont({
  src: '../assets/fonts/eb-garamond-latin-var.woff2',
  weight: '400 800',
  display: 'swap',
  preload: false,
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
    <html lang="en" className={`${outfit.variable} ${ebGaramond.variable} ${cormorantSc.variable}`} suppressHydrationWarning>
      <head>
        {/* Optional: restores saved light/dark on admin; system mode uses CSS prefers-color-scheme */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <SettingsHistoryBoundary />
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
