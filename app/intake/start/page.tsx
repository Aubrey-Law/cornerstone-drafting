import { PublicIntakeStartForm } from './PublicIntakeStartForm'
import { AuthShell } from '@/components/layout/AuthShell'

export const dynamic = 'force-dynamic'

export default function PublicIntakeStartPage() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? ''
  return (
    <AuthShell
      className="items-start py-6 sm:items-center sm:py-12 [&_img]:h-auto [&_img]:w-40 sm:[&_img]:w-[220px]"
      contentClassName="max-w-xl space-y-5 sm:space-y-7"
      homeHref="/"
      logoWidth={220}
      logoHeight={128}
    >
      <section className="rounded-lg border bg-card p-5 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-foreground">Start your estate-planning intake</h1>
        <p className="mb-5 mt-2 text-sm text-muted-foreground sm:mb-6">
          Create a secure portal account, then complete the questionnaire at your own pace.
        </p>
        <PublicIntakeStartForm siteKey={siteKey} />
      </section>
    </AuthShell>
  )
}
