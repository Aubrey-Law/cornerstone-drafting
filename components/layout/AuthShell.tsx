import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AuthShellProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  homeHref?: string
  logoWidth?: number
  logoHeight?: number
}

/** Shared branded surface for sign-in, registration, and account recovery. */
export function AuthShell({
  children,
  className,
  contentClassName,
  homeHref = '/auth/login',
  logoWidth = 240,
  logoHeight = 140,
}: AuthShellProps) {
  return (
    <main className={cn('dark flex min-h-screen items-start justify-center bg-background text-foreground px-4 py-6 sm:items-center sm:py-12', className)}>
      <div className={cn('w-full max-w-md space-y-5 sm:space-y-8', contentClassName)}>
        <div className="flex justify-center">
          <Link
            href={homeHref}
            aria-label="Aubrey Law home"
            className="block w-[var(--auth-logo-mobile-width)] rounded-sm transition-opacity hover:opacity-90 sm:w-[var(--auth-logo-width)]"
            style={{
              '--auth-logo-mobile-width': `${Math.min(160, logoWidth)}px`,
              '--auth-logo-width': `${logoWidth}px`,
            } as CSSProperties}
          >
            <Image
              src="/logos/aubrey-law-stacked-dark.svg"
              alt="Aubrey Law"
              width={logoWidth}
              height={logoHeight}
              className="h-auto w-full"
              priority
            />
          </Link>
        </div>
        {children}
      </div>
    </main>
  )
}
