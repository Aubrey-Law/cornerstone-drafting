import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase, getCachedClaims } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { findClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { Button } from '@/components/ui/button'
import { stageLabel, type MatterStage } from '@/types/database'

export default async function PortalDashboardPage() {
  const auth = await getCachedClaims()
  if (!auth) redirect('/auth/login')

  const supabase = await createServerSupabase()
  const intake = await findClientIntakeForUser(supabase, auth.id)
  const matter = await getMatterForUser(supabase, auth.id)

  const firstName = (intake?.first_name as string | null | undefined) ?? null
  const intakeStatus = (intake?.status as string | null | undefined) ?? 'draft'
  const submitted = intakeStatus === 'submitted' || intakeStatus === 'approved'

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Client portal
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">
        Welcome{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Track your intake, documents, and messages with the firm.
      </p>

      <div className="mt-8 space-y-4">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Intake</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {submitted
              ? 'Your questionnaire has been submitted. The firm will review it shortly.'
              : 'Complete your intake questionnaire so we can begin drafting.'}
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/intake">{submitted ? 'View intake' : 'Continue intake'}</Link>
          </Button>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Matter status</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {matter
              ? `Current stage: ${stageLabel((matter.stage ?? 'intake') as MatterStage)}`
              : 'Your matter is being set up. Check back after intake review.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/documents">Documents</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/messages">Messages</Link>
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Schedule an appointment</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Book time with the firm — only open times on our calendar are shown.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/schedule">Find a time</Link>
          </Button>
        </section>
      </div>
    </div>
  )
}
