'use client'

import { useEffect, useRef, useState } from 'react'
import BookingQuestionFields from '@/components/scheduling/BookingQuestionFields'
import SlotPicker, { fmtLongDay, fmtTime } from '@/components/scheduling/SlotPicker'
import {
  BookingCard,
  BrandHeader,
  EventMeta,
  FOCUS,
  fmtRange,
  LOCATION_LABEL,
  type LocationType,
  PRIMARY_BUTTON,
  ResultPanel,
  TimeSummary,
} from '@/components/scheduling/bookingUi'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BookingQuestion } from '@/lib/appointments/bookingQuestions'
import { formatPhoneInput } from '@/lib/phone'
import { parseBookingPrefill } from '@/lib/bookings/prefill'

type Step = 'pick' | 'details' | 'done'

export interface BookingWidgetType {
  key: string
  slug: string
  label: string
  description: string
  durationMinutes: number
  locationType: LocationType
  /** Formats the client may choose from, in display order. */
  locationTypes?: LocationType[]
  /** Extra questions asked on the details step (Settings → Scheduling). */
  bookingQuestions?: BookingQuestion[]
}

export interface BookingWidgetProps {
  type: BookingWidgetType
  /** Prefill for signed-in portal clients. */
  defaultFirstName?: string
  defaultLastName?: string
  defaultEmail?: string
  defaultPhone?: string
  /** Locks the email field (portal: the session email is authoritative). */
  emailLocked?: boolean
  /**
   * Public /book page: show the firm wordmark and make the title the page's
   * h1. The portal embeds the widget under its own header instead.
   */
  standalone?: boolean
  firmName?: string
  /** The office for in-person appointments (from firm settings). */
  officeAddress?: string
}

const FIELD = 'h-12 rounded-lg bg-card px-3.5 text-base md:text-base @3xl/booking:h-[46px]'
const FIELD_LABEL = 'mb-1.5 text-base leading-snug font-medium text-foreground'

export default function BookingWidget({
  type,
  defaultFirstName = '',
  defaultLastName = '',
  defaultEmail = '',
  defaultPhone = '',
  emailLocked = false,
  standalone = false,
  firmName = 'Aubrey Law',
  officeAddress,
}: BookingWidgetProps) {
  const locationOptions: LocationType[] =
    type.locationTypes && type.locationTypes.length > 0 ? type.locationTypes : [type.locationType]
  const [step, setStep] = useState<Step>('pick')
  const [selected, setSelected] = useState<string | null>(null)
  const [locationType, setLocationType] = useState<LocationType>(locationOptions[0])
  const [firstName, setFirstName] = useState(defaultFirstName)
  const [lastName, setLastName] = useState(defaultLastName)
  const [email, setEmail] = useState(defaultEmail)
  const [phone, setPhone] = useState(() => formatPhoneInput(defaultPhone))
  const [includeSpouse, setIncludeSpouse] = useState(false)
  const [spouseFirstName, setSpouseFirstName] = useState('')
  const [spouseLastName, setSpouseLastName] = useState('')
  const [spouseEmail, setSpouseEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmedStart, setConfirmedStart] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // A link the firm sent (or staff opening this page for a client) carries the
  // client's details in the URL fragment. Fill empty fields, then drop the
  // fragment so it is not left in the address bar or copied onward.
  useEffect(() => {
    if (!standalone || emailLocked || !window.location.hash) return
    const prefill = parseBookingPrefill(window.location.hash)
    if (prefill.firstName) setFirstName(current => current || prefill.firstName!)
    if (prefill.lastName) setLastName(current => current || prefill.lastName!)
    if (prefill.email) setEmail(current => current || prefill.email!)
    if (prefill.phone) setPhone(current => current || formatPhoneInput(prefill.phone!))
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [standalone, emailLocked])

  const Title = standalone ? 'h1' : 'h2'
  const shownTime = step === 'done' ? confirmedStart : selected

  function goTo(next: Step) {
    setStep(next)
    // On narrow layouts the client is usually scrolled down to the sticky bar.
    const root = rootRef.current
    if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView?.({ block: 'start' })
  }

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/scheduling/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typeKey: type.key,
          startTime: selected,
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          notes: notes || undefined,
          answers,
          locationType,
          secondAttendeeFirstName: includeSpouse ? spouseFirstName || undefined : undefined,
          secondAttendeeLastName: includeSpouse ? spouseLastName || undefined : undefined,
          secondAttendeeEmail: includeSpouse ? spouseEmail || undefined : undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        startTime?: string
        error?: string
        code?: string
      }
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Booking failed. Please try again.')
        if (json.code === 'slot_taken') {
          setSelected(null)
          setRefreshKey(k => k + 1)
          goTo('pick')
        }
        return
      }
      setConfirmedStart(json.startTime ?? selected)
      goTo('done')
      // Staff can open this page inside the app; tell that dialog it is booked.
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'cornerstone:booking-confirmed' }, window.location.origin)
      }
    } catch {
      setError('Booking failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCard = selected && (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-brand-teal bg-selected px-4 py-3.5 text-selected-foreground @5xl/booking:hidden">
      <div>
        <p className="text-lg font-semibold">{fmtLongDay(new Date(selected))}</p>
        <p className="text-base">{fmtRange(selected, type.durationMinutes)}</p>
      </div>
      <button
        type="button"
        className={`min-h-11 rounded-md px-2 text-base font-semibold underline underline-offset-4 ${FOCUS}`}
        onClick={() => goTo('pick')}
      >
        Change<span className="sr-only"> time</span>
      </button>
    </div>
  )

  return (
    <BookingCard
      rootRef={rootRef}
      aside={
        <>
          {standalone && <BrandHeader firmName={firmName} />}
          <div className="flex flex-col gap-2.5">
            <Title className="text-2xl leading-[1.2] font-semibold tracking-[-0.015em] text-primary @5xl/booking:text-3xl">
              {type.label}
            </Title>
            {type.description && (
              <p className="text-base leading-normal text-pretty text-muted-foreground @5xl/booking:leading-[1.55]">
                {type.description}
              </p>
            )}
          </div>

          <EventMeta durationMinutes={type.durationMinutes} locationType={locationType} officeAddress={officeAddress} />

          {locationOptions.length > 1 && step !== 'done' && (
            <fieldset>
              <legend className="mb-2 text-base font-medium text-foreground">
                How would you like to meet?
              </legend>
              <div className="flex flex-wrap gap-2 @5xl/booking:flex-col">
                {locationOptions.map(option => (
                  <label
                    key={option}
                    className={`flex min-h-11 grow cursor-pointer items-center rounded-lg border px-3.5 @3xl/booking:grow-0 @5xl/booking:grow py-2.5 text-base transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60 ${
                      locationType === option
                        ? 'border-brand-teal bg-selected font-medium text-selected-foreground'
                        : 'border-border bg-card text-foreground hover:border-brand-teal'
                    }`}
                  >
                    <input
                      type="radio"
                      name="booking-location"
                      className="sr-only"
                      checked={locationType === option}
                      onChange={() => setLocationType(option)}
                    />
                    {LOCATION_LABEL[option]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {shownTime && (
            <TimeSummary
              label="Your time"
              iso={shownTime}
              durationMinutes={type.durationMinutes}
              dayLabel={fmtLongDay(new Date(shownTime))}
            />
          )}
        </>
      }
    >
          <div hidden={step !== 'pick'} className="h-full">
            <SlotPicker
              typeSlug={type.slug}
              selected={selected}
              onSelect={setSelected}
              refreshKey={refreshKey}
              notice={step === 'pick' ? error : null}
              onContinue={() => {
                setError(null)
                goTo('details')
              }}
            />
          </div>

          {step === 'details' && selected && (
            <form
              className="flex flex-col gap-5 p-5 @3xl/booking:gap-[22px] @3xl/booking:px-10 @3xl/booking:py-9"
              onSubmit={e => {
                e.preventDefault()
                void submit()
              }}
            >
              {selectedCard}
              <button
                type="button"
                className={`hidden self-start rounded-md text-base font-medium text-brand-teal hover:underline @5xl/booking:block ${FOCUS}`}
                onClick={() => goTo('pick')}
              >
                ← Change time
              </button>
              <div>
                <h2 className="text-2xl font-semibold text-foreground">
                  Your details
                </h2>
                <p className="mt-1 text-base text-muted-foreground">
                  We&apos;ll send a confirmation and calendar invitation to your email.
                </p>
              </div>

              <div className="grid gap-[18px] @3xl/booking:grid-cols-2 @3xl/booking:gap-x-5">
                <div>
                  <Label htmlFor="booking-first-name" className={FIELD_LABEL}>First name</Label>
                  <Input
                    id="booking-first-name"
                    className={FIELD}
                    required
                    maxLength={80}
                    autoComplete="given-name"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-last-name" className={FIELD_LABEL}>Last name</Label>
                  <Input
                    id="booking-last-name"
                    className={FIELD}
                    required
                    maxLength={80}
                    autoComplete="family-name"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-email" className={FIELD_LABEL}>Email</Label>
                  <Input
                    id="booking-email"
                    className={FIELD}
                    type="email"
                    required
                    autoComplete="email"
                    readOnly={emailLocked}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-phone" className={FIELD_LABEL}>
                    Phone
                    {locationType !== 'phone' && (
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    )}
                  </Label>
                  <Input
                    id="booking-phone"
                    className={FIELD}
                    type="tel"
                    autoComplete="tel"
                    required={locationType === 'phone'}
                    value={phone}
                    onChange={e => setPhone(formatPhoneInput(e.target.value))}
                    placeholder="(555) 555-5555"
                  />
                </div>

                <label
                  className={`flex cursor-pointer items-start gap-3.5 rounded-[10px] border px-4 py-3.5 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60 @3xl/booking:col-span-2 ${
                    includeSpouse
                      ? 'border-brand-teal bg-selected'
                      : 'border-border bg-[var(--booking-panel)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-[18px] shrink-0 accent-brand-teal outline-none"
                    aria-labelledby="booking-spouse-toggle"
                    aria-describedby="booking-spouse-toggle-hint"
                    checked={includeSpouse}
                    onChange={e => setIncludeSpouse(e.target.checked)}
                  />
                  <span>
                    <span id="booking-spouse-toggle" className="block text-base font-medium text-foreground">
                      Include my spouse or partner
                    </span>
                    <span id="booking-spouse-toggle-hint" className="block text-sm text-muted-foreground">
                      They&apos;ll receive the calendar invite and reminders too.
                    </span>
                  </span>
                </label>

                {includeSpouse && (
                  <>
                    <div>
                      <Label htmlFor="booking-spouse-first-name" className={FIELD_LABEL}>
                        Spouse/partner first name
                      </Label>
                      <Input
                        id="booking-spouse-first-name"
                        className={FIELD}
                        required
                        maxLength={80}
                        value={spouseFirstName}
                        onChange={e => setSpouseFirstName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="booking-spouse-last-name" className={FIELD_LABEL}>
                        Spouse/partner last name
                      </Label>
                      <Input
                        id="booking-spouse-last-name"
                        className={FIELD}
                        required
                        maxLength={80}
                        value={spouseLastName}
                        onChange={e => setSpouseLastName(e.target.value)}
                      />
                    </div>
                    <div className="@3xl/booking:col-span-2">
                      <Label htmlFor="booking-spouse-email" className={FIELD_LABEL}>
                        Spouse/partner email
                      </Label>
                      <Input
                        id="booking-spouse-email"
                        className={FIELD}
                        type="email"
                        value={spouseEmail}
                        onChange={e => setSpouseEmail(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <BookingQuestionFields
                  questions={type.bookingQuestions ?? []}
                  answers={answers}
                  onChange={(id, answer) => setAnswers(a => ({ ...a, [id]: answer }))}
                />

                <div className="@3xl/booking:col-span-2">
                  <Label htmlFor="booking-notes" className={FIELD_LABEL}>
                    Anything we should know?
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="booking-notes"
                    className="rounded-lg bg-card px-3.5 text-base md:text-base"
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className={`${PRIMARY_BUTTON} h-[52px] w-full px-7 text-lg @3xl/booking:h-[50px] @3xl/booking:w-auto @3xl/booking:self-start @3xl/booking:text-base`}
              >
                {submitting ? 'Booking…' : 'Confirm booking'}
              </button>
            </form>
          )}

          {step === 'done' && confirmedStart && (
            <ResultPanel icon="✓" title="You're booked">
              <p className="text-lg leading-[1.6] text-foreground">
                {type.label} — {fmtLongDay(new Date(confirmedStart))} at {fmtTime(confirmedStart)}
              </p>
              <p className="text-base text-muted-foreground">
                A confirmation email and calendar invitation are on their way to{' '}
                <span className="font-semibold text-foreground">{email}</span>.
                {locationType === 'phone' && ' We’ll call you at the number you provided.'}
              </p>
            </ResultPanel>
          )}
    </BookingCard>
  )
}
