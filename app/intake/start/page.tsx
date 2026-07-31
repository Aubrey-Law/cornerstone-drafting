import { PublicIntakeStartForm } from './PublicIntakeStartForm'
import { AuthShell } from '@/components/layout/AuthShell'

export const dynamic = 'force-dynamic'

export default function PublicIntakeStartPage() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? ''
  return (
    <AuthShell contentClassName="max-w-xl space-y-7" homeHref="/" logoWidth={220} logoHeight={128}>
      <section className="rounded-lg border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-foreground">Start your estate-planning intake</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          Create a secure portal account, then complete the questionnaire at your own pace.
        </p>
        <PublicIntakeStartForm siteKey={siteKey} />
      </section>
    </AuthShell>
  )
}
