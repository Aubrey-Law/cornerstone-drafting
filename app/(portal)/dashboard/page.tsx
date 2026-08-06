import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Check, FileText, Mail, Phone, Upload } from 'lucide-react'
import { createServerSupabase, getCachedClaims } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { findClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { Button } from '@/components/ui/button'
import { getFirmConfig } from '@/lib/firmConfig'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import {
  fetchLatestFirmMessage,
  fetchNextAppointment,
  fetchPortalMatterMeta,
  fetchRecentPortalDocuments,
  fetchUnreadFirmMessageCount,
} from '@/lib/queries/portal'
import { stageInfo, type MatterStage, type StageGroup } from '@/types/database'
import type { MatterDocument } from '@/types/database'

export const dynamic = 'force-dynamic'

/* ─── stage tracker ───────────────────────────────────────────────────────── */

const TRACKER_STEPS: { group: StageGroup; label: string }[] = [
  { group: 'early', label: 'Intake' },
  { group: 'active', label: 'Drafting' },
  { group: 'work', label: 'Your review' },
  { group: 'done', label: 'Signing' },
  { group: 'closed', label: 'Complete' },
]

/** One plain-language sentence per stage group for the "What's next" card. */
const WHATS_NEXT: Record<StageGroup, string> = {
  early:
    "We're reviewing what you've sent and setting up your matter. Nothing is needed from you right now — we'll reach out if we have questions.",
  active:
    "Attorney is preparing your documents. Drafts typically arrive here within 2 weeks — we'll message you when they're ready.",
  work:
    'Your drafts are ready to read. Take your time, and send us any questions or changes through Messages before we finalize.',
  done:
    "Your documents are final and we're getting them signed. We'll confirm the signing details with you and walk you through the day.",
  closed:
    'Your estate plan is complete. Signed copies live in Documents — reach out any time your family or finances change.',
}

const APPOINTMENT_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

const APPOINTMENT_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: FIRM_TIMEZONE,
})

const STARTED_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

const DOC_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

/** "today" / "yesterday" / "3 days ago" — calendar days in the firm timezone. */
function relativeDay(iso: string): string {
  const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
  const then = new Date(dayKey(new Date(iso)))
  const now = new Date(dayKey(new Date()))
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  return STARTED_DATE.format(new Date(iso))
}

function senderLabel(role: string, attorneyShortName: string): string {
  return role === 'attorney' ? attorneyShortName : 'The firm'
}

function excerpt(body: string, max = 90): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`
}

/* ─── page ────────────────────────────────────────────────────────────────── */

export default async function PortalDashboardPage() {
  const auth = await getCachedClaims()
  if (!auth) redirect('/auth/login')

  const supabase = await createServerSupabase()
  const intake = await findClientIntakeForUser(supabase, auth.id)
  const matter = await getMatterForUser(supabase, auth.id)

  const firstName = (intake?.first_name as string | null | undefined) ?? null
  const intakeStatus = (intake?.status as string | null | undefined) ?? 'draft'
  const submitted = intakeStatus === 'submitted' || intakeStatus === 'approved'

  // Matter-scoped reads only run once ownership is established above.
  const [meta, documents, latestMessage, unreadCount, appointment] = matter
    ? await Promise.all([
        fetchPortalMatterMeta(matter.id),
        fetchRecentPortalDocuments(matter.id, auth.id, 2),
        fetchLatestFirmMessage(matter.id),
        fetchUnreadFirmMessageCount(matter.id),
        fetchNextAppointment(matter.id),
      ])
    : [null, [] as MatterDocument[], null, 0, null]

  const firm = getFirmConfig()
  const group: StageGroup = matter ? stageInfo((matter.stage ?? 'intake') as MatterStage).group : 'early'
  const currentIndex = TRACKER_STEPS.findIndex(s => s.group === group)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* ── header ── */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your estate plan
          </p>
          <h1
            className="mt-1 text-3xl font-semibold text-foreground"
            style={{ fontFamily: 'var(--font-lora), ui-serif, Georgia, serif' }}
          >
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        {matter && (
          <p className="text-sm text-muted-foreground sm:text-right">
            {meta?.matterName ?? 'Your matter'}
            {meta?.createdAt && ` · started ${STARTED_DATE.format(new Date(meta.createdAt))}`}
          </p>
        )}
      </div>

      {/* ── stage tracker ── */}
      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <ol className="flex items-start">
          {TRACKER_STEPS.map((step, i) => {
            const done = i < currentIndex
            const current = i === currentIndex
            return (
              <li key={step.group} className="flex min-w-0 flex-1 items-start last:flex-none">
                <div className="flex min-w-0 shrink flex-col items-center gap-1.5 px-0.5">
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border-2"
                    style={
                      done
                        ? { background: 'var(--primary)', borderColor: 'var(--primary)' }
                        : current
                          ? { borderColor: 'var(--primary)' }
                          : { borderColor: 'var(--border)' }
                    }
                  >
                    {done && <Check className="size-3 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <span
                    className={[
                      'text-center text-[11px] leading-tight sm:text-xs',
                      current
                        ? 'font-semibold text-foreground'
                        : done
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {step.label}
                  </span>
                </div>
                {i < TRACKER_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="mt-[9px] h-0.5 min-w-2 flex-1"
                    style={{ background: done ? 'var(--primary)' : 'var(--border)' }}
                  />
                )}
              </li>
            )
          })}
        </ol>
        {!matter && (
          <p className="mt-4 text-sm text-muted-foreground">Your matter is being set up.</p>
        )}
      </section>

      {/* ── what's next ── */}
      <section
        className="mt-4 rounded-lg border p-5"
        style={{ background: 'var(--blue-bg)', borderColor: 'var(--blue-strong-border)' }}
      >
        <h2 className="text-sm font-semibold text-foreground">What&apos;s next</h2>
        {submitted ? (
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">{WHATS_NEXT[group]}</p>
        ) : (
          <>
            <p className="mt-1 text-sm leading-relaxed text-foreground/80">
              Finish your intake questionnaire so we can begin drafting. Your answers save as you
              go, so you can stop and come back any time.
            </p>
            <Button asChild size="sm" className="mt-4">
              <Link href="/intake">Continue intake</Link>
            </Button>
          </>
        )}
      </section>

      {/* ── documents + messages ── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Recent documents</h2>
          {documents.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No documents shared yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {documents.map(doc => (
                <li key={doc.id} className="flex items-start gap-2.5">
                  {doc.source === 'client' ? (
                    <Upload className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOC_DATE.format(new Date(doc.created_at))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/documents"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            All documents →
          </Link>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Messages</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {unreadCount} unread
              </span>
            )}
          </div>
          {latestMessage ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-foreground">
                {excerpt(latestMessage.body)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {senderLabel(latestMessage.senderRole, firm.attorneyShortName)} ·{' '}
                {relativeDay(latestMessage.createdAt)}
              </p>
              <Button asChild size="sm" variant="outline" className="mt-4">
                <Link href="/messages">Reply</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">No messages yet</p>
              <Button asChild size="sm" className="mt-4">
                <Link href="/messages">Send a message</Link>
              </Button>
            </>
          )}
        </section>
      </div>

      {/* ── appointment + firm contact ── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {appointment && (
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Next appointment</h2>
            <p className="mt-2 text-sm font-medium text-foreground">
              {appointment.typeLabel ?? 'Appointment'}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {APPOINTMENT_DATE.format(new Date(appointment.startTime))} at{' '}
              {APPOINTMENT_TIME.format(new Date(appointment.startTime))}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <Link href="/schedule">Manage</Link>
            </Button>
          </section>
        )}

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{firm.firmName}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Questions? Reach us directly — we&apos;re happy to help.
          </p>
          <div className="mt-3 space-y-1.5">
            <a
              href={`tel:${firm.phone.replace(/[^\d+]/g, '')}`}
              className="flex items-center gap-2 text-sm text-foreground hover:underline"
            >
              <Phone className="size-4 shrink-0 text-muted-foreground" />
              {firm.phone}
            </a>
            <a
              href={`mailto:${firm.email}`}
              className="flex items-center gap-2 text-sm text-foreground hover:underline"
            >
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{firm.email}</span>
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
