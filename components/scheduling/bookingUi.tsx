'use client'

import type { ReactNode, Ref } from 'react'
import { fmtTime, useBrowserTimeZone } from '@/components/scheduling/SlotPicker'
import { DEFAULT_OFFICE_ADDRESS } from '@/lib/appointments/officeAddress'

/**
 * The split-card shell shared by the client booking surfaces (/book/[slug],
 * the portal Schedule page and /book/manage/[token]): event details in a left
 * panel on wide layouts, a header on narrow ones, and the step content beside
 * or below it. Layout follows the `booking` container, not the viewport, so the
 * same card works full-page and embedded.
 */

export type LocationType = 'phone' | 'teams' | 'in_person'

/**
 * What the client is told about the format. The video service (Google Meet or
 * Teams) is the firm's choice after booking, so the copy doesn't name one.
 */
export function locationHint(locationType: LocationType, officeAddress: string = DEFAULT_OFFICE_ADDRESS): string {
  switch (locationType) {
    case 'phone':
      return 'Phone call — we’ll call the number you provide'
    case 'teams':
      return 'Video call — meeting link will be provided in your calendar invite'
    case 'in_person':
      return `In person at our office (${officeAddress})`
  }
}

export const LOCATION_LABEL: Record<LocationType, string> = {
  phone: 'Phone call',
  teams: 'Video call',
  in_person: 'In person',
}

export function isLocationType(value: string): value is LocationType {
  return value in LOCATION_LABEL
}

export const EYEBROW = 'text-xs font-semibold tracking-[.07em] uppercase'
export const FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
export const PRIMARY_BUTTON = `rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-[var(--booking-primary-hover)] disabled:pointer-events-none disabled:opacity-60 ${FOCUS}`

export function fmtRange(iso: string, durationMinutes: number): string {
  const end = new Date(Date.parse(iso) + durationMinutes * 60_000).toISOString()
  return `${fmtTime(iso)} – ${fmtTime(end)}`
}

function Wordmark({ firmName, compact }: { firmName: string; compact?: boolean }) {
  const words = firmName.trim().split(/\s+/)
  const last = words.length > 1 ? words.pop() : null
  return (
    <div style={{ fontFamily: 'var(--font-eb-garamond), Georgia, serif' }}>
      <p
        className={`flex gap-2.5 leading-none tracking-[.08em] uppercase ${compact ? 'text-xl' : 'text-2xl'}`}
        style={{ fontFamily: 'var(--font-cormorant-sc), var(--font-eb-garamond), Georgia, serif' }}
      >
        <span className="text-brand-navy dark:text-foreground">{words.join(' ')}</span>
        {last && <span className="text-brand-teal">{last}</span>}
      </p>
      {!compact && (
        <p className="mt-1.5 text-compact leading-none text-brand-navy italic dark:text-muted-foreground">
          Your Legacy. Carefully Planned.
        </p>
      )}
    </div>
  )
}

/** Firm wordmark: compact on narrow layouts, with the tagline on wide ones. */
export function BrandHeader({ firmName }: { firmName: string }) {
  return (
    <>
      <div className="@5xl/booking:hidden">
        <Wordmark firmName={firmName} compact />
      </div>
      <div className="hidden @5xl/booking:block">
        <Wordmark firmName={firmName} />
      </div>
    </>
  )
}

/**
 * Length / format / time zone: one wrapping line on narrow layouts, a labelled
 * list on wide ones. `extra` rows go first in the list (e.g. the booked time).
 */
export function EventMeta({
  durationMinutes,
  locationType,
  officeAddress,
  extra = [],
}: {
  durationMinutes: number
  locationType: LocationType | null
  /** Shown for in-person appointments; defaults to the Needham office. */
  officeAddress?: string
  extra?: [string, string][]
}) {
  const tz = useBrowserTimeZone()
  const inline = [
    `${durationMinutes} minutes`,
    locationType ? LOCATION_LABEL[locationType] : null,
    tz?.name ?? null,
  ].filter((v): v is string => Boolean(v))
  const rows: [string, string][] = [
    ...extra,
    ['Length', `${durationMinutes} minutes`],
    ...(locationType ? [['Format', locationHint(locationType, officeAddress)] as [string, string]] : []),
    ...(tz ? [['Time zone', tz.name] as [string, string]] : []),
  ]
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground @5xl/booking:hidden">
        {inline.map((v, i) => (
          <span key={v} className="contents">
            {i > 0 && (
              <span aria-hidden className="text-border">
                |
              </span>
            )}
            <span>{v}</span>
          </span>
        ))}
      </p>
      <dl className="hidden flex-col gap-3.5 @5xl/booking:flex">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className={`${EYEBROW} text-muted-foreground`}>{label}</dt>
            <dd className="mt-0.5 text-base leading-normal text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/** Teal time summary pinned to the bottom of the wide left panel. */
export function TimeSummary({
  label,
  iso,
  durationMinutes,
  dayLabel,
}: {
  label: string
  iso: string
  durationMinutes: number
  dayLabel: string
}) {
  return (
    <div className="mt-auto hidden rounded-[10px] border border-brand-teal bg-selected px-4 py-3.5 text-selected-foreground @5xl/booking:block">
      <p className={EYEBROW}>{label}</p>
      <p className="mt-1 text-lg font-semibold">{dayLabel}</p>
      <p className="text-base">{fmtRange(iso, durationMinutes)}</p>
    </div>
  )
}

export function BookingCard({
  rootRef,
  aside,
  children,
}: {
  rootRef?: Ref<HTMLDivElement>
  aside: ReactNode
  children: ReactNode
}) {
  return (
    <div ref={rootRef} className="client-booking @container/booking scroll-mt-4">
      <div className="overflow-clip bg-background text-foreground @3xl/booking:rounded-[14px] @3xl/booking:border @3xl/booking:border-border @3xl/booking:bg-card @3xl/booking:shadow-[0_1px_2px_rgba(31,45,90,.04),0_12px_32px_-12px_rgba(31,45,90,.12)] @5xl/booking:grid @5xl/booking:min-h-[620px] @5xl/booking:grid-cols-[320px_minmax(0,1fr)]">
        {/* Event details: a header on narrow layouts, the left panel on wide ones. */}
        <aside className="flex flex-col gap-3.5 border-b border-border bg-card px-5 pt-7 pb-5 @3xl/booking:px-8 @5xl/booking:gap-7 @5xl/booking:border-r @5xl/booking:border-b-0 @5xl/booking:py-9">
          {aside}
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  )
}

/** Centered result screen (booked, cancelled, moved) inside the card's right area. */
export function ResultPanel({
  icon,
  tone = 'success',
  title,
  children,
}: {
  icon: string
  tone?: 'success' | 'neutral'
  title: string
  children: ReactNode
}) {
  return (
    <div
      role="status"
      className="flex h-full max-w-[560px] flex-col items-center justify-center gap-3.5 px-5 py-10 text-center @3xl/booking:p-12 @5xl/booking:items-start @5xl/booking:text-left"
    >
      <div
        aria-hidden
        className={`grid size-14 place-items-center rounded-full text-2xl font-semibold @3xl/booking:size-[52px] ${
          tone === 'success' ? 'bg-selected text-brand-teal' : 'bg-muted text-muted-foreground'
        }`}
      >
        {icon}
      </div>
      <h2 className="text-3xl font-semibold text-primary">{title}</h2>
      {children}
    </div>
  )
}
