import Image from 'next/image'
import Link from 'next/link'
import { PublicIntakeStartForm } from './PublicIntakeStartForm'

export const dynamic = 'force-dynamic'

export default function PublicIntakeStartPage() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? ''
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 dark">
      <div className="w-full max-w-xl space-y-7">
        <div className="flex justify-center">
          <Link href="/" aria-label="Aubrey Law home">
            <Image src="/logos/aubrey-law-stacked-dark.svg" alt="Aubrey Law" width={220} height={128} priority />
          </Link>
        </div>
        <section className="rounded-lg border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-foreground">Start your estate-planning intake</h1>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">
            Create a secure portal account, then complete the questionnaire at your own pace.
          </p>
          <PublicIntakeStartForm siteKey={siteKey} />
        </section>
      </div>
    </main>
  )
}
