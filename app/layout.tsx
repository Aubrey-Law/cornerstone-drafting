import type { Metadata, Viewport } from 'next'
import { DM_Sans, Lora } from 'next/font/google'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { THEME_INIT_SCRIPT } from '@/lib/theme/theme-init-script'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

// Exposed as `--font-lora`, not `--font-serif`: the Tailwind theme bridge
// (styles/theme/tailwind-bridge.css) maps `--font-serif` to the sans stack, so
// anything injected under that name is shadowed and never renders.
const lora = Lora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-lora',
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
    <html lang="en" className={`${dmSans.variable} ${lora.variable}`} suppressHydrationWarning>
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
