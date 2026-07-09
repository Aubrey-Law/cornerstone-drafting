import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getOrCreateClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getFirmConfig } from '@/lib/firmConfig'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'
import SimplifiedIntakeForm from '@/components/intake/SimplifiedIntakeForm'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

const firm = getFirmConfig()

export default async function IntakeHomePage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const intake = await getOrCreateClientIntakeForUser(supabase, user)
  const intakeId = intake.id as string
  const submitted = intake.status === 'submitted' || intake.status === 'approved'

  if (submitted) {
    const firstName = (intake.first_name as string) || null
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground">
                Thank you{firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We&apos;ve received your questionnaire. The firm will review it shortly.
                To request changes, email{' '}
                <a href={`mailto:${firm.email}`} className="underline">{firm.email}</a>.
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link href="/dashboard">Return to dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  let spouse: Awaited<ReturnType<typeof loadSpouseContact>> = null
  let children: Awaited<ReturnType<typeof loadHouseholdChildren>> = []
  try {
    const admin = getAdminClient()
    const [spouseRow, childRows] = await Promise.all([
      loadSpouseContact(admin, intakeId),
      loadHouseholdChildren(admin, intakeId),
    ])
    spouse = spouseRow
    children = childRows ?? []
  } catch (err) {
    console.error('[intake page] household load failed:', err)
  }

  const initialData: Record<string, unknown> = {
    ...intake,
    spouse_first_name: spouse?.first_name ?? '',
    spouse_last_name: spouse?.last_name ?? '',
    spouse_middle_name: spouse?.middle_name ?? '',
    spouse_date_of_birth: spouse?.date_of_birth ?? '',
    spouse_email: spouse?.email ?? '',
    spouse_phone: spouse?.phone ?? '',
    // DesignSheetChild uses display `name` + `dob`; the form splits name on load.
    children: children.map((c) => ({
      name: c.name,
      dob: c.dob,
      date_of_birth: c.dob,
    })),
  }

  return <SimplifiedIntakeForm initialData={initialData} intakeId={intakeId} />
}
