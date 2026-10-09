import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { listPortalForms } from '@/lib/forms/portalForms'
import { PortalPageHeader } from '../PortalPageHeader'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' })

function StatusLine({ status }: { status: 'not_started' | 'sent' | 'in_progress' | 'submitted' }) {
  if (status === 'submitted') return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-green" aria-hidden />Submitted</span>
  if (status === 'in_progress') return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CircleDot className="h-3.5 w-3.5 text-amber" aria-hidden />In progress</span>
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Circle className="h-3.5 w-3.5" aria-hidden />Not started</span>
}

/** Every questionnaire and form this client has been asked to fill in. */
export default async function PortalFormsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/forms')

  let lists: Awaited<ReturnType<typeof listPortalForms>>
  try {
    lists = await listPortalForms(user.id)
  } catch {
    return <div className="mx-auto max-w-3xl px-4 py-8"><p role="alert" className="text-sm">Your forms are temporarily unavailable. Please try again shortly.</p></div>
  }
  // Questionnaires name the person when there is more than one, so a parent
  // filling in their own and a child's can tell them apart.
  const showPeople = lists.questionnaires.length > 1
  const rows = [
    ...lists.questionnaires.map(item => ({ key: item.intakeId, title: item.title, person: showPeople ? item.personName : null, status: item.status, href: item.href, detail: null as string | null })),
    ...lists.forms.map(item => ({ key: item.id, title: item.title, person: showPeople ? item.personName : null, status: item.status, href: item.href,
      detail: item.submittedAt ? `Submitted ${dateFormat.format(new Date(item.submittedAt))}` : `Sent ${dateFormat.format(new Date(item.sentAt))}` })),
  ]

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PortalPageHeader title="Forms" description="Questionnaires and forms we have asked you to fill out. Your answers save as you go." />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to fill out right now.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map(row => (
            <li key={row.key}>
              <Link href={row.href} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{row.title}</span>
                  <span className="block text-xs text-muted-foreground">{[row.person, row.detail].filter(Boolean).join(' · ')}</span>
                </span>
                <StatusLine status={row.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
