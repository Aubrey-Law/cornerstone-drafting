import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Check, FileText, Landmark, Mail, PenLine, Phone, Upload } from 'lucide-react'
import { createServerSupabase, getCachedClaims } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { findClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { Button } from '@/components/ui/button'
import { PortalPageHeader } from '../PortalPageHeader'
import { PortalAccountCard } from '@/components/portal/PortalAccountCard'
import { getFirmConfig } from '@/lib/firmConfig'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import {
  fetchLatestFirmMessage,
  fetchNextAppointment,
  fetchOpenPortalDocumentRequests,
  fetchPortalAccount,
  fetchPortalMatterMeta,
  fetchRecentPortalDocuments,
  fetchSharedDocuments,
  fetchUnreadFirmMessageCount,
} from '@/lib/queries/portal'
import type { DocumentRequest } from '@/lib/documentRequests/model'
import { progressFromMatterDetails } from '@/lib/portal/progress'
import { computePortalNextAction } from '@/lib/portal/nextActions'
import { describePlanStatus } from '@/lib/portal/planStatus'
import { fetchLatestPlanStatus, loadPlanStatusFacts } from '@/lib/portal/planStatusServer'
import { fetchPortalSignatures } from '@/lib/portal/signaturesServer'
import {
  portalSigningHref,
  signatureStatusLine,
  signatureTitle,
  summarisePendingSignatures,
  type PortalSignature,
} from '@/lib/portal/signatures'
import { fetchPortalAssets } from '@/lib/funding/portalServer'
import { PORTAL_STATE_LABELS, summarisePortalAssets, type PortalAsset } from '@/lib/funding/portal'
import type { MatterDocument } from '@/types/database'

export const dynamic = 'force-dynamic'

/* ─── stage tracker ───────────────────────────────────────────────────────── */

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
  const settled = async <T,>(promise: Promise<T>, fallback: T) => {
    try {
      return { value: await promise, available: true }
    } catch {
      return { value: fallback, available: false }
    }
  }

  const [metaResult, documentsResult, sharedResult, messageResult, unreadResult, appointmentResult, accountResult, requestsResult, planStatusResult, signaturesResult, assetsResult] = matter
    ? await Promise.all([
        settled(fetchPortalMatterMeta(matter.id), null),
        settled(fetchRecentPortalDocuments(matter.id, auth.id, 2), [] as MatterDocument[]),
        settled(fetchSharedDocuments(matter.id, 1), [] as MatterDocument[]),
        settled(fetchLatestFirmMessage(matter.id), null),
        settled(fetchUnreadFirmMessageCount(matter.id), 0),
        settled(fetchNextAppointment(matter.id), null),
        settled(fetchPortalAccount(matter.id), null),
        settled(fetchOpenPortalDocumentRequests(matter.id), [] as DocumentRequest[]),
        settled(fetchLatestPlanStatus(matter.id), null),
        settled(fetchPortalSignatures(matter.id, auth.email ?? null), [] as PortalSignature[]),
        settled(fetchPortalAssets(matter.id), [] as PortalAsset[]),
      ])
    : [
        { value: null, available: true },
        { value: [] as MatterDocument[], available: true },
        { value: [] as MatterDocument[], available: true },
        { value: null, available: true },
        { value: 0, available: true },
        { value: null, available: true },
        { value: null, available: true },
        { value: [] as DocumentRequest[], available: true },
        { value: null, available: true },
        { value: [] as PortalSignature[], available: true },
        { value: [] as PortalAsset[], available: true },
      ]

  // "Where is my plan?" The last update the firm published, when there is
  // one; otherwise the plain sentences written from the record itself, so
  // the client always has an answer, never a blank card.
  const publishedStatus = planStatusResult.value
  const plainStatus = matter && !publishedStatus
    ? (await settled(loadPlanStatusFacts(matter.id), null)).value
    : null
  const planStatus = publishedStatus
    ? { body: publishedStatus.body, publishedAt: publishedStatus.publishedAt }
    : plainStatus
      ? { body: describePlanStatus(plainStatus.facts), publishedAt: null }
      : null

  const meta = metaResult.value
  const documents = documentsResult.value
  const latestMessage = messageResult.value
  const unreadCount = unreadResult.value
  const appointment = appointmentResult.value
  const account = accountResult.value
  const openRequests = requestsResult.value
  // What awaits a signature: the client's own items first, then anyone else's.
  const pendingSignatures = summarisePendingSignatures(signaturesResult.value)
  // The funding work that is the client's: the accounts they retitle themselves.
  const assets = assetsResult.value
  const funding = summarisePortalAssets(assets)
  const fundingStage = matter?.stage === 'signing_complete' || matter?.stage === 'post_execution' || matter?.stage === 'funding'
  const assetsTodo = assets.filter(asset => asset.state === 'todo' || asset.state === 'checking')

  const firm = getFirmConfig()
  const progress = meta?.progress ?? progressFromMatterDetails(null)
  const nextAction = computePortalNextAction({
    hasMatter: matter !== null,
    intakeComplete: submitted,
    matterStatus: matter?.status ?? null,
    matterStage: matter?.stage ?? null,
    sharedDocumentCount: sharedResult.value.length,
    unreadFirmMessageCount: unreadCount,
    hasUpcomingAppointment: appointment !== null,
    outstandingInvoiceCount: account?.invoices.filter(invoice => invoice.balanceCents > 0).length ?? 0,
    openDocumentRequestCount: openRequests.length,
    pendingSignatureCount: pendingSignatures.mine.length,
    pendingSignatureHref: pendingSignatures.href,
    fundingTodoCount: funding.todo,
    factsAvailable: sharedResult.available && unreadResult.available && appointmentResult.available && accountResult.available,
  })

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* The serif comes from `.client-root` on the portal shell; every
          client-facing heading gets it. Only the dashboard names the plan
          above its title. */}
      <PortalPageHeader
        eyebrow={progress.heading}
        title={`Welcome back${firstName ? `, ${firstName}` : ''}`}
        aside={matter ? (
          <>
            {meta?.matterName ?? 'Your matter'}
            {meta?.createdAt && ` · started ${STARTED_DATE.format(new Date(meta.createdAt))}`}
          </>
        ) : null}
      />

      {/* ── stage tracker ── */}
      <section className="rounded-lg border border-border bg-card p-5">
        <ol className="flex items-start">
          {progress.milestones.map((step, i) => {
            const done = step.state === 'completed'
            const current = step.state === 'current'
            return (
              <li key={step.key} className="flex min-w-0 flex-1 items-start last:flex-none">
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
                      'text-center text-micro leading-tight sm:text-xs',
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
                {i < progress.milestones.length - 1 && (
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
        {progress.milestones.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">The firm will share progress updates through Messages.</p>
        )}
      </section>

      {/* ── where your plan stands ── */}
      {planStatus && (
        <section className="mt-4 rounded-lg border border-border bg-card p-5" data-testid="plan-status">
          <h2 className="text-sm font-semibold text-foreground">Where your plan stands</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{planStatus.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {planStatus.publishedAt
              ? `From ${firm.attorneyShortName} · ${relativeDay(planStatus.publishedAt)}`
              : 'Drawn from your matter record'}
          </p>
        </section>
      )}

      {/* ── what's next ── */}
      <section
        className="mt-4 rounded-lg border p-5"
        style={{ background: 'var(--blue-bg)', borderColor: 'var(--blue-strong-border)' }}
      >
        <h2 className="text-sm font-semibold text-foreground">What&apos;s next</h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground/80">{nextAction.message}</p>
        {nextAction.href && nextAction.label && (
          <Button asChild size="sm" className="mt-4">
            <Link href={nextAction.href}>{nextAction.label}</Link>
          </Button>
        )}
      </section>

      {/* ── ready for your signature ── */}
      {signaturesResult.value.length > 0 && (
        <section className="mt-4 rounded-lg border border-border bg-card p-5" data-testid="pending-signatures">
          <h2 className="text-sm font-semibold text-foreground">Ready for your signature</h2>
          <ul className="mt-3 space-y-2">
            {[...pendingSignatures.mine, ...pendingSignatures.others].slice(0, 4).map(signature => (
              <li key={signature.sessionId} className="flex items-start gap-2.5">
                <PenLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{signatureTitle(signature)}</p>
                  <p className="text-xs text-muted-foreground">{signatureStatusLine(signature)}</p>
                </div>
              </li>
            ))}
          </ul>
          {pendingSignatures.mine.length > 0 && (
            <Button asChild size="sm" className="mt-4">
              <Link href={pendingSignatures.mine.length === 1 ? portalSigningHref(pendingSignatures.mine[0].sessionId) : '/documents#sign'}>
                Review and sign
              </Link>
            </Button>
          )}
        </section>
      )}

      {/* ── your assets, once the plan is signed ── */}
      {fundingStage && assets.length > 0 && (
        <section className="mt-4 rounded-lg border border-border bg-card p-5" data-testid="portal-funding">
          <h2 className="text-sm font-semibold text-foreground">Moving your assets into the plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {funding.done} of {funding.total} in the plan
            {funding.todo > 0 ? ` · ${funding.todo} need${funding.todo === 1 ? 's' : ''} your action` : ''}
            {funding.checking > 0 ? ` · ${funding.checking} being checked` : ''}.
          </p>
          {assetsTodo.length > 0 && (
            <ul className="mt-3 space-y-2">
              {assetsTodo.slice(0, 4).map(asset => (
                <li key={asset.assetId} className="flex items-start gap-2.5">
                  <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{asset.description || asset.categoryLabel}</p>
                    <p className="text-xs text-muted-foreground">{PORTAL_STATE_LABELS[asset.state]}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button asChild size="sm" variant={funding.todo > 0 ? 'default' : 'outline'} className="mt-4">
            <Link href="/assets">{funding.todo > 0 ? 'See what to do' : 'See your assets'}</Link>
          </Button>
        </section>
      )}

      {/* ── what the firm has asked for ── */}
      {openRequests.length > 0 && (
        <section className="mt-4 rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">What we need from you</h2>
          <ul className="mt-3 space-y-2">
            {openRequests.slice(0, 4).map(request => (
              <li key={request.id} className="flex items-start gap-2.5">
                <Upload className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{request.title}</p>
                  {request.dueOn && <p className="text-xs text-muted-foreground">Due {request.dueOn}</p>}
                </div>
              </li>
            ))}
          </ul>
          {openRequests.length > 4 && (
            <p className="mt-2 text-xs text-muted-foreground">And {openRequests.length - 4} more.</p>
          )}
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href="/documents#requests">Upload what we need</Link>
          </Button>
        </section>
      )}

      {/* Only shown when there is something to say: a client with no invoices
          should not be told their balance is zero. */}
      {matter && !accountResult.available && <p role="alert" className="mt-4 text-sm text-destructive">Billing is temporarily unavailable. <Link href="/account" className="underline">Retry billing</Link></p>}
      {account && account.invoices.length > 0 && (
        <div className="mt-4">
          <PortalAccountCard account={account} />
        </div>
      )}

      {/* ── documents + messages ── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Recent documents</h2>
          {!documentsResult.available ? (
            <p role="alert" className="mt-2 text-sm text-destructive">Documents are temporarily unavailable. <Link href="/documents" className="underline">Retry documents</Link></p>
          ) : documents.length === 0 ? (
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
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href="/documents">All documents</Link>
          </Button>
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
              <p className="mt-2 text-sm text-muted-foreground">No messages yet.</p>
              <Button asChild size="sm" variant="outline" className="mt-4">
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
