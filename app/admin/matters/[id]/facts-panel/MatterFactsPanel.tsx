'use client'

import { listenForMatterContacts, notifyMatterContactsChanged } from '@/lib/matters/contactEvents'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { formatAssetCurrency } from '@/lib/assets/format'
import { ageInYearsFromDob, formatDobWithAge, toDateInputValue } from '@/lib/dob'
import { normalizeTargetSigningDate, targetSigningDateInput } from '@/lib/matterDates'
import { PRACTICE_AREA_OPTIONS, normalizePracticeArea } from '@/lib/practiceArea'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { resolveDraftingDate, DRAFTING_DATE_COLUMNS } from '@/lib/matter/draftingDates'
import { EMPTY_PLAN_MIRROR, type MatterPlanMirror } from '@/lib/matter/planMirror'
import { isCoupleMatter, type MatterType } from '@/lib/matter/matterType'
import { MARITAL_STATUS_OPTIONS } from '@/lib/sharedFields'
import {
  REFERRAL_SOURCE_OPTIONS,
  normalizeReferralSource,
  quietDays,
  referralSourceOtherFallback,
} from '@/lib/matter/referralSource'
import { cn, formatDate } from '@/lib/utils'
import type { CommChannel } from '@/lib/comms/thread'
import type { MatterTab } from '@/lib/matterPageTabs'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import type { MatterActivity, PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { parseContactChannels, type ContactChannel } from '@/lib/contacts/additionalChannels'
import { ChannelListField } from '@/components/contacts/ChannelListField'
import { MatterReadinessDial, type MatterReadinessItem } from '../MatterReadinessDial'
import { InlineAddress, type AddressParts } from './InlineAddress'
import { InlineDate, InlineSelect, InlineText, ReadOnlyRow } from './InlineField'
import { PanelActivity } from './PanelActivity'
import { PanelSection } from './PanelSection'
import { useSectionState, useShowEmptyFields } from './useSectionState'

interface ClientRecord {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  additional_emails?: ContactChannel[] | null
  additional_phones?: ContactChannel[] | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  date_of_birth: string | null
  marital_status: string | null
  has_minor_children: boolean | null
}

interface ContactRecord {
  id: string
  relationship_type: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  additional_emails?: ContactChannel[] | null
  additional_phones?: ContactChannel[] | null
  date_of_birth: string | null
}

export interface MatterFactsPanelProps {
  datesRequest?: number
  keyDates?: ReactNode
  matter: PipelineMatter
  matterId: string
  matterType: MatterType | null
  matterTypeSaving?: boolean
  details: MatterDetailsRow | null
  designSheetPlanType: string | null
  /** Design-sheet-owned plan facts, resolved server-side and read-only here. */
  planMirror?: MatterPlanMirror
  /** max(communications.created_at) — the quiet chip is derived, never stored. */
  lastContactAt?: string | null
  /** Which timeline channel that last contact was on. */
  lastContactChannel?: CommChannel | null
  estate: MatterEstateSnapshot
  /** Kept from the previous rail — the panel must not drop the readiness dial. */
  simplified?: boolean
  readinessItems: MatterReadinessItem[]
  activity: MatterActivity[]
  noteText: string
  onNoteTextChange: (value: string) => void
  onAddNote: () => void
  noteSaving: boolean
  noteCount: number
  latestNoteAt: string | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
  onSaveMatterType: (matterType: MatterType) => Promise<void>
  savingField: keyof MatterDetailsRow | null
  lastSavedAt: string | null
  error: string | null
  onOpenTab: (tab: MatterTab) => void
  /** Matter number, status and engagement rows, rendered first in the Matter section. */
  adminRows?: ReactNode
}

// Shared registry vocabulary (all six values) so a status the intake portal
// stored — separated, domestic partner — renders instead of showing '—' and
// being silently overwritten on the next edit. Lowercase to match the row's
// muted inline style.
const CHANNEL_LABEL: Record<CommChannel, string> = { portal: 'Portal', sms: 'Text', email: 'Email' }

const MARITAL_OPTIONS = [
  { value: '', label: '—' },
  ...MARITAL_STATUS_OPTIONS.map(option => ({ value: option.value, label: option.label.toLowerCase() })),
]

const URGENCY_OPTIONS = [
  { value: 'high', label: 'Urgency: high' },
  { value: 'normal', label: 'Urgency: normal' },
  { value: 'low', label: 'Urgency: low' },
]

const FEE_STATUS_OPTIONS = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'deposit', label: 'Partial payment' },
  { value: 'paid_in_full', label: 'Paid in full' },
]

const TAX_DECISION_OPTIONS = [
  { value: 'tax-sensitive', label: 'Tax-sensitive' },
  { value: 'not-tax-sensitive', label: 'Not tax-sensitive' },
  { value: 'not-reviewed', label: 'Not reviewed' },
]

function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}

function taxDecisionValue(value: boolean | null | undefined): string {
  if (value === true) return 'tax-sensitive'
  if (value === false) return 'not-tax-sensitive'
  return 'not-reviewed'
}

/** "None · 2 adult" — minors by DOB, falling back to the intake flag. */
function minorChildrenLabel(children: ContactRecord[], flag: boolean | null | undefined): string {
  if (children.length === 0) return flag ? 'Yes' : flag === false ? 'None' : '—'
  let minors = 0
  let adults = 0
  for (const child of children) {
    const age = ageInYearsFromDob(child.date_of_birth)
    if (age === null) adults += 1
    else if (age < 18) minors += 1
    else adults += 1
  }
  const minorPart = minors === 0 ? 'None' : `${minors} minor`
  return adults > 0 ? `${minorPart} · ${adults} adult` : minorPart
}

/**
 * The matter's standing facts as one inline-editable rail: identity header plus
 * six collapsible sections. Matter fields save through `onSaveField`
 * (matter_details); client and spouse fields go to the contacts route the
 * People tab already uses. No field here owns its own API surface.
 */
export function MatterFactsPanel({
  datesRequest = 0,
  keyDates,
  matter,
  matterId,
  matterType,
  details,
  designSheetPlanType,
  planMirror = EMPTY_PLAN_MIRROR,
  lastContactAt = null,
  lastContactChannel = null,
  estate,
  simplified = false,
  readinessItems,
  activity,
  noteText,
  onNoteTextChange,
  onAddNote,
  noteSaving,
  noteCount,
  latestNoteAt,
  onSaveField,
  savingField,
  lastSavedAt,
  error,
  onOpenTab,
  adminRows,
}: MatterFactsPanelProps) {
  const token = useAccessToken()
  const { open, toggle, collapseAll, setSectionOpen } = useSectionState()
  useEffect(() => {
    if (!datesRequest) return
    setSectionOpen('dates', true)
    const frame = requestAnimationFrame(() => document.getElementById('facts-dates-content')?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [datesRequest, setSectionOpen])
  const { showEmpty, toggleShowEmpty } = useShowEmptyFields()
  // Passed to every optional row: an empty one disappears until the operator
  // asks to see it. Rows the rail is built around (address, target signing)
  // stay put so the panel never loses its shape.
  const hideWhenEmpty = !showEmpty
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactsRevision, setContactsRevision] = useState(0)
  useEffect(() => listenForMatterContacts(matterId, () => setContactsRevision(n => n + 1), 'facts'), [matterId])

  useEffect(() => {
    let cancelled = false
    setLoadingContacts(true)
    void (async () => {
      try {
        const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!res.ok) throw new Error('Could not load contacts')
        const body = (await res.json()) as { client?: ClientRecord; contacts?: ContactRecord[] }
        if (cancelled) return
        setClient(body.client ?? null)
        setContacts(Array.isArray(body.contacts) ? body.contacts : [])
      } catch {
        /* the matter fields still work without the intake row */
      } finally {
        if (!cancelled) setLoadingContacts(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [matterId, token, contactsRevision])

  const spouse = useMemo(
    () => contacts.find(contact => contact.relationship_type === 'spouse') ?? null,
    [contacts],
  )
  const children = useMemo(
    () => contacts.filter(contact => contact.relationship_type === 'child'),
    [contacts],
  )

  const patchContacts = useCallback(
    async (body: Record<string, unknown>, onLocal: () => void) => {
      try {
        const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload.error ?? 'Could not save')
        onLocal()
        notifyMatterContactsChanged(matterId, 'facts')
        toast.success('Saved', { id: 'matter-panel-save', duration: 1200 })
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : 'Could not save')
        throw caught
      }
    },
    [matterId, token],
  )

  const saveClientField = useCallback(
    (field: keyof ClientRecord, value: string | boolean | null) =>
      patchContacts({ target: 'client', patch: { [field]: value } }, () =>
        setClient(current => (current ? { ...current, [field]: value } : current)),
      ),
    [patchContacts],
  )

  const saveClientChannels = useCallback(
    (field: 'additional_emails' | 'additional_phones', channels: ContactChannel[]) =>
      patchContacts({ target: 'client', patch: { [field]: channels } }, () =>
        setClient(current => (current ? { ...current, [field]: channels } : current)),
      ),
    [patchContacts],
  )

  const saveSpouseField = useCallback(
    (field: keyof ContactRecord, value: string | null) => {
      if (!spouse) return Promise.resolve()
      return patchContacts(
        { target: 'contact', contactId: spouse.id, patch: { [field]: value } },
        () =>
          setContacts(current =>
            current.map(contact =>
              contact.id === spouse.id ? { ...contact, [field]: value } : contact,
            ),
          ),
      )
    },
    [patchContacts, spouse],
  )

  const saveSpouseChannels = useCallback(
    (field: 'additional_emails' | 'additional_phones', channels: ContactChannel[]) => {
      if (!spouse) return Promise.resolve()
      return patchContacts(
        { target: 'contact', contactId: spouse.id, patch: { [field]: channels } },
        () =>
          setContacts(current =>
            current.map(contact =>
              contact.id === spouse.id ? { ...contact, [field]: channels } : contact,
            ),
          ),
      )
    },
    [patchContacts, spouse],
  )

  const clientName = client?.full_name
    || [client?.first_name, client?.last_name].filter(Boolean).join(' ')
    || matter.client_name
    || matter.matter_name
    || 'Matter'
  const maritalStatus = client?.marital_status ?? matter.marital_status ?? ''
  const dob = client?.date_of_birth ?? matter.client_dob ?? null
  const age = ageInYearsFromDob(dob)
  const cityState = [client?.city, client?.state].filter(Boolean).join(', ')
  const address: AddressParts = {
    address_line1: client?.address_line1 ?? '',
    city: client?.city ?? '',
    state: client?.state ?? '',
    zip: client?.zip ?? '',
  }

  const practiceArea = normalizePracticeArea(details?.practice_area ?? matter.practice_area)
  const spouseName = [spouse?.first_name, spouse?.last_name].filter(Boolean).join(' ')
    || matter.spouse_name
    || ''
  const spouseDob = spouse?.date_of_birth ?? matter.spouse_dob ?? null
  // Contact editing includes married clients even when only one spouse is represented.
  const isCouple = maritalStatus.toLowerCase() === 'married' || isCoupleMatter(matterType)
  const planLabel = designSheetPlanType || planMirror.planType
    ? designPlanTypeLabel(designSheetPlanType ?? planMirror.planType)
    : '—'
  const referralSource = normalizeReferralSource(details?.referral_source ?? matter.referral_source)
  // Derived from the communications timeline — never a stored last_client_contact.
  const quiet = quietDays(lastContactAt)
  const draftsDue = resolveDraftingDate(details, 'drafts_due')
  const draftsReview = resolveDraftingDate(details, 'drafts_review')
  const revisions = resolveDraftingDate(details, 'revisions')
  const designHref = `/admin/drafting/${matterId}?step=design`
  const openedAt = matter.opened_at || matter.matter_created || null
  const lastContactLabel = lastContactAt
    ? `${formatDate(lastContactAt)}${lastContactChannel ? ` · ${CHANNEL_LABEL[lastContactChannel]}` : ''}`
    : null
  // Real estate and pets are the firm's own answer and drive which items the
  // stage-task checklist carries, so they toggle. Credit shelter and minor
  // children are read-only: the design sheet and the household own those.
  const planFlagChips: Array<{
    label: string
    on: boolean
    field?: keyof MatterDetailsRow
  }> = [
    {
      label: 'Real estate',
      on: details?.ep_has_real_estate ?? planMirror.hasRealEstate,
      field: 'ep_has_real_estate',
    },
    { label: 'Credit shelter', on: planMirror.creditShelter },
    {
      label: 'Minor children',
      on: planMirror.hasMinorChildren
        || Boolean(client?.has_minor_children ?? matter.has_minor_children),
    },
    { label: 'Pets', on: details?.ep_has_pets ?? planMirror.hasPets, field: 'ep_has_pets' },
  ]

  const flatFee = details?.flat_fee_amount ?? matter.fee_amount ?? null

  const saveStatus = savingField
    ? 'Saving…'
    : error
      ? error
      : lastSavedAt
        ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : null

  const skeleton = (
    <div className="space-y-1.5 px-1.5 py-1" aria-hidden>
      <div className="h-4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
    </div>
  )

  return (
    <div className={cn("flex w-full flex-col divide-y divide-border bg-card", !simplified && "h-full overflow-y-auto")}>
      {/* Identity */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9.5 shrink-0 place-items-center rounded-full bg-muted text-compact font-bold text-muted-foreground">
            {initialsFor(clientName) || '—'}
          </div>
          <div className="min-w-0 flex-1">
            <input
              aria-label="Client name"
              defaultValue={clientName}
              key={clientName}
              onBlur={event => {
                const next = event.target.value.trim()
                if (next && next !== clientName) void saveClientField('full_name', next).catch(() => {})
              }}
              className="-ml-1.5 h-6.5 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold tracking-[-0.012em] outline-none hover:border-input hover:bg-background focus:border-ring focus:bg-background"
            />
            <div className="flex items-center gap-1 text-micro text-muted-foreground">
              {age !== null && <span className="tabular-nums">{age} ·</span>}
              <select
                aria-label="Marital status"
                value={maritalStatus}
                onChange={event => void saveClientField('marital_status', event.target.value || null).catch(() => {})}
                className="field-sizing-content h-5.5 rounded border border-transparent bg-transparent px-1 text-micro text-muted-foreground hover:border-input hover:bg-background focus:border-ring focus:outline-none"
              >
                {MARITAL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {cityState && <span>· {cityState}</span>}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <select
            aria-label="Urgency"
            value={details?.urgency ?? 'normal'}
            onChange={event => void onSaveField('urgency', event.target.value)}
            className="field-sizing-content h-5.5 rounded-full border border-amber-border bg-amber-bg px-1.5 text-micro font-semibold text-amber focus:outline-none"
          >
            {URGENCY_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="Fee status"
            value={details?.fee_payment_status ?? (details?.fee_collected ? 'paid_in_full' : 'unpaid')}
            onChange={event => void onSaveField('fee_payment_status', event.target.value)}
            className="field-sizing-content h-5.5 rounded-full border border-transparent bg-muted px-1.5 text-micro font-semibold text-foreground focus:outline-none"
          >
            {FEE_STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="Attorney decision"
            value={taxDecisionValue(details?.ep_ma_estate_taxable)}
            onChange={event => void onSaveField(
              'ep_ma_estate_taxable',
              event.target.value === 'not-reviewed' ? null : event.target.value === 'tax-sensitive',
            )}
            className="field-sizing-content h-5.5 rounded-full border border-transparent bg-primary/10 px-1.5 text-micro font-semibold text-primary focus:outline-none"
          >
            {TAX_DECISION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {/* The sections keep their open/closed state on their own; saying so
            took a third of this row and squeezed both buttons onto two lines. */}
        <div className="mt-2 flex items-center justify-end gap-3 whitespace-nowrap text-micro">
          <span className="flex items-center gap-3">
            <button
              type="button"
              aria-pressed={showEmpty}
              onClick={toggleShowEmpty}
              className="font-semibold text-primary hover:underline"
            >
              {showEmpty ? 'Hide empty fields' : 'Show empty fields'}
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="font-semibold text-primary hover:underline"
            >
              Collapse all
            </button>
          </span>
        </div>
      </div>

      {!simplified && <MatterReadinessDial items={readinessItems} className="p-4" />}

      {/* Matter — administrative fields first, then practice, plan, fees and source. */}
      <PanelSection
        id="facts-matter"
        title="Matter"
        open={open.matter}
        onToggle={() => toggle('matter')}
        hint={!open.matter && openedAt
          ? `Opened ${formatDate(openedAt)}${lastContactLabel ? ` · last contact ${lastContactLabel}` : ''}`
          : undefined}
      >
        {adminRows}
        <InlineSelect
          label="Practice area"
          value={practiceArea}
          options={PRACTICE_AREA_OPTIONS}
          onSave={next => onSaveField('practice_area', next)}
        />
        {/* The design sheet owns plan composition — read-only, link out to edit. */}
        <ReadOnlyRow label="Plan">
          <Link href={designHref} className="font-semibold text-primary hover:underline">
            {planLabel}
          </Link>
        </ReadOnlyRow>
        <InlineText
          label="Flat fee"
          tabular
          hideWhenEmpty={hideWhenEmpty}
          value={flatFee == null ? '' : String(flatFee)}
          display={flatFee == null ? undefined : formatAssetCurrency(flatFee)}
          onSave={next => onSaveField('flat_fee_amount', next ? Number(next.replace(/[^0-9.]/g, '')) : null)}
        />
        <InlineSelect
          label="Lead source"
          value={referralSource}
          options={[...REFERRAL_SOURCE_OPTIONS]}
          onSave={next => onSaveField('referral_source', next)}
        />
        {referralSource === 'other' && (
          <InlineText
            label="Lead source detail"
            value={referralSourceOtherFallback(
              details?.referral_source ?? matter.referral_source,
              details?.referral_source_other,
            )}
            onSave={next => onSaveField('referral_source_other', next)}
          />
        )}
        <ReadOnlyRow
          label="Opened"
          tabular
          empty={!openedAt}
          hideWhenEmpty={hideWhenEmpty}
        >
          {openedAt ? formatDate(openedAt) : '—'}
        </ReadOnlyRow>
        <ReadOnlyRow
          label="Last contact"
          tabular
          empty={!lastContactAt}
          hideWhenEmpty={hideWhenEmpty}
          onClick={() => onOpenTab('communications')}
        >
          {lastContactLabel ?? '—'}
        </ReadOnlyRow>

        {/* Same snapshot the Assets tab renders — one computation, two surfaces. */}
        {!simplified && <div className="mx-1.5 mt-1.5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <div className="bg-card px-2.5 py-2">
            <div className="text-micro text-muted-foreground">Gross estate est.</div>
            <div className="mt-px text-sm font-bold tracking-[-0.016em] tabular-nums">
              {formatAssetCurrency(estate.grossEstateEstimate)}
            </div>
          </div>
          <div className="bg-amber-bg px-2.5 py-2">
            <div className="text-micro text-amber">Estimated MA tax</div>
            <div className="mt-px text-sm font-bold tracking-[-0.016em] text-amber tabular-nums">
              {formatAssetCurrency(estate.estimatedMaTax)}
            </div>
          </div>
          <div className="bg-card px-2.5 py-2">
            <div className="text-micro text-muted-foreground">With credit shelter</div>
            <div className="mt-px text-sm font-bold tracking-[-0.016em] tabular-nums">
              {formatAssetCurrency(estate.maTaxWithCreditShelter)}
            </div>
          </div>
          <div className="bg-card px-2.5 py-2">
            <div className="text-micro text-muted-foreground">Difference</div>
            <div className="mt-px text-sm font-bold tracking-[-0.016em] text-green tabular-nums">
              {formatAssetCurrency(estate.creditShelterSavings)}
            </div>
          </div>
        </div>}
        {simplified && <Button variant="link" size="sm" onClick={() => onOpenTab('assets')}>Review estate values and tax estimates in Assets</Button>}

      </PanelSection>

      {/* Plan flags — what the plan has to cover. Chips read from the design
          sheet; the ones the design sheet owns link back to it to change. */}
      <PanelSection
        id="facts-flags"
        title="Plan flags"
        open={open.flags}
        onToggle={() => toggle('flags')}
        hint={
          !open.flags
            ? planFlagChips.filter(chip => chip.on).map(chip => chip.label).join(' · ') || undefined
            : undefined
        }
      >
        <div className="flex flex-wrap gap-1.5 px-1.5 pb-1">
          {planFlagChips.map(chip => {
            const className = cn(
              'rounded-full border px-1.5 py-0.5 text-micro font-semibold',
              chip.on
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground',
            )
            const label = chip.on ? chip.label : `No ${chip.label.toLowerCase()}`
            if (!chip.field) {
              return <span key={chip.label} className={className}>{label}</span>
            }
            const field = chip.field
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={chip.on}
                onClick={() => void onSaveField(field, !chip.on)}
                className={cn(className, 'hover:brightness-95')}
              >
                {label}
              </button>
            )
          })}
        </div>
        <p className="px-1.5 pt-1 text-xs text-muted-foreground">Edit document choices in <Link href={designHref} className="text-primary underline underline-offset-4">the design sheet</Link>.</p>
      </PanelSection>

      {/* Contact */}
      <PanelSection
        id="facts-contact"
        title="Client contact"
        open={open.contact}
        onToggle={() => toggle('contact')}
        hint={!open.contact ? client?.email ?? matter.client_email : undefined}
      >
        {quiet !== null && (
          <div className="px-1.5 pb-1">
            <span
              className={cn(
                'rounded-full border px-1.5 py-0.5 text-micro font-semibold',
                quiet >= 21
                  ? 'border-amber-border bg-amber-bg text-amber'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              Quiet {quiet} day{quiet === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {loadingContacts ? skeleton : (
          <>
            <InlineText
              label="Email"
              hideWhenEmpty={hideWhenEmpty}
              value={client?.email ?? matter.client_email ?? ''}
              onSave={next => saveClientField('email', next || null)}
            />
            <ChannelListField
              label="Other emails"
              kind="email"
              hideWhenEmpty={hideWhenEmpty}
              channels={parseContactChannels(client?.additional_emails)}
              onSave={next => saveClientChannels('additional_emails', next)}
            />
            <InlineText
              label="Phone"
              tabular
              hideWhenEmpty={hideWhenEmpty}
              value={client?.phone ?? matter.client_phone ?? ''}
              onSave={next => saveClientField('phone', next || null)}
            />
            <ChannelListField
              label="Other phones"
              kind="phone"
              hideWhenEmpty={hideWhenEmpty}
              channels={parseContactChannels(client?.additional_phones)}
              onSave={next => saveClientChannels('additional_phones', next)}
            />
            <InlineAddress
              hideWhenEmpty={hideWhenEmpty}
              value={address}
              onSave={next =>
                patchContacts(
                  {
                    target: 'client',
                    patch: {
                      address_line1: next.address_line1 || null,
                      city: next.city || null,
                      state: next.state || null,
                      zip: next.zip || null,
                    },
                  },
                  () => setClient(current => (current ? { ...current, ...next } : current)),
                )
              }
            />
            <InlineDate
              label="Date of birth"
              hideWhenEmpty={hideWhenEmpty}
              value={toDateInputValue(dob)}
              onSave={next => saveClientField('date_of_birth', next || null)}
            />
            {dob && (
              <p className="px-1.5 text-right text-micro text-muted-foreground tabular-nums">
                {formatDobWithAge(dob)}
              </p>
            )}
            <ReadOnlyRow
              label="Minor children"
              empty={minorChildrenLabel(children, client?.has_minor_children ?? matter.has_minor_children) === '—'}
              hideWhenEmpty={hideWhenEmpty}
              onClick={() => onOpenTab('people')}
            >
              {minorChildrenLabel(children, client?.has_minor_children ?? matter.has_minor_children)}
            </ReadOnlyRow>
          </>
        )}
      </PanelSection>

      {/* Spouse */}
      {isCouple && (
        <PanelSection
          id="facts-spouse"
          title="Spouse"
          open={open.spouse}
          onToggle={() => toggle('spouse')}
          hint={spouseName || undefined}
        >
          {loadingContacts ? skeleton : spouse ? (
            <>
              <InlineText
                label="Name"
                value={spouseName}
                onSave={next => {
                  const parts = next.trim().split(/\s+/)
                  const last = parts.length > 1 ? parts.pop() ?? '' : ''
                  return patchContacts(
                    {
                      target: 'contact',
                      contactId: spouse.id,
                      patch: { first_name: parts.join(' '), last_name: last },
                    },
                    () =>
                      setContacts(current =>
                        current.map(contact =>
                          contact.id === spouse.id
                            ? { ...contact, first_name: parts.join(' '), last_name: last }
                            : contact,
                        ),
                      ),
                  )
                }}
              />
              <InlineText
                label="Email"
                hideWhenEmpty={hideWhenEmpty}
                value={spouse.email ?? matter.spouse_email ?? ''}
                onSave={next => saveSpouseField('email', next || null)}
              />
              <ChannelListField
                label="Other emails"
                kind="email"
                hideWhenEmpty={hideWhenEmpty}
                channels={parseContactChannels(spouse.additional_emails)}
                onSave={next => saveSpouseChannels('additional_emails', next)}
              />
              <InlineText
                label="Phone"
                tabular
                hideWhenEmpty={hideWhenEmpty}
                value={spouse.phone ?? matter.spouse_phone ?? ''}
                onSave={next => saveSpouseField('phone', next || null)}
              />
              <ChannelListField
                label="Other phones"
                kind="phone"
                hideWhenEmpty={hideWhenEmpty}
                channels={parseContactChannels(spouse.additional_phones)}
                onSave={next => saveSpouseChannels('additional_phones', next)}
              />
              <InlineDate
                label="Date of birth"
                hideWhenEmpty={hideWhenEmpty}
                value={toDateInputValue(spouseDob)}
                onSave={next => saveSpouseField('date_of_birth', next || null)}
              />
              {spouseDob && (
                <p className="px-1.5 text-right text-micro text-muted-foreground tabular-nums">
                  {formatDobWithAge(spouseDob)}
                </p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onOpenTab('people')}
              className="px-1.5 text-micro text-primary hover:underline"
            >
              Add a spouse on the People tab
            </button>
          )}
        </PanelSection>
      )}

      {/* Dates */}
      <PanelSection
        id="facts-dates"
        title="Matter dates"
        open={open.dates}
        onToggle={() => toggle('dates')}
        hint={
          details?.scheduled_signing_date
            ? `Signing ${formatDate(details.scheduled_signing_date)}`
            : undefined
        }
      >
        {keyDates}
        {!keyDates && <>
        <InlineDate
          label="Engagement signed"
          hideWhenEmpty={hideWhenEmpty}
          value={toDateInputValue(details?.engagement_signed_at ?? null)}
          onSave={next => onSaveField('engagement_signed_at', next || null)}
        />
        <InlineDate
          label="Target signing"
          emphasized
          value={targetSigningDateInput(details?.scheduled_signing_date)}
          onSave={next => onSaveField(
            'scheduled_signing_date',
            next ? normalizeTargetSigningDate(next) : null,
          )}
        />
        <InlineDate
          label="Design meeting"
          hideWhenEmpty={hideWhenEmpty}
          value={toDateInputValue(details?.design_meeting_date ?? null)}
          onSave={next => onSaveField('design_meeting_date', next || null)}
        />
        </>}
        {/* Drafts due has no column — it is derived from target signing or nothing. */}
        <ReadOnlyRow label="Drafts due" empty={!draftsDue.value} hideWhenEmpty={keyDates ? false : hideWhenEmpty}>
          <span className="tabular-nums">
            {draftsDue.value ? formatDate(draftsDue.value) : '—'}
          </span>
          {draftsDue.derived && (
            <span className="text-micro font-semibold uppercase tracking-[.05em] text-primary">
              auto
            </span>
          )}
        </ReadOnlyRow>
        <InlineDate
          label="Drafts review"
          derived={draftsReview.derived}
          hideWhenEmpty={keyDates ? false : hideWhenEmpty}
          value={draftsReview.value}
          onSave={next => onSaveField(DRAFTING_DATE_COLUMNS.drafts_review!, next || null)}
        />
        <InlineDate
          label="Revisions"
          derived={revisions.derived}
          hideWhenEmpty={keyDates ? false : hideWhenEmpty}
          value={revisions.value}
          onSave={next => onSaveField(DRAFTING_DATE_COLUMNS.revisions!, next || null)}
        />
        {!keyDates && <InlineDate
          label="Plan signed"
          hideWhenEmpty={hideWhenEmpty}
          value={toDateInputValue(details?.signing_date ?? matter.signing_date ?? null)}
          onSave={next => onSaveField('signing_date', next || null)}
        />}
        {/* Not part of the plan timeline — this is what drives the header pill
            and the weekly board, so it sits below a rule. */}
        <div className="mx-1.5 mt-1.5 border-t border-dashed border-border pt-1.5">
          <InlineDate
            label="Next action"
            emphasized
            value={toDateInputValue(details?.next_action_date ?? null)}
            onSave={next => onSaveField('next_action_date', next || null)}
          />
        </div>
      </PanelSection>

      {!simplified && <>
      {/* Notes */}
      <PanelSection
        id="facts-notes"
        title="Notes"
        open={open.notes}
        onToggle={() => toggle('notes')}
        hint={
          noteCount > 0
            ? `${noteCount}${latestNoteAt ? ` · latest ${formatDate(latestNoteAt)}` : ''}`
            : undefined
        }
      >
        <div className="px-1.5">
          <Textarea
            aria-label="Note"
            rows={3}
            value={noteText}
            onChange={event => onNoteTextChange(event.target.value)}
            onBlur={() => { if (noteText.trim()) onAddNote() }}
            className="text-xs"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2.5">
            <span className="text-micro text-muted-foreground">Saves on blur</span>
            <Button
              type="button"
              size="sm"
              className="h-7 text-micro"
              disabled={noteSaving || !noteText.trim()}
              onClick={onAddNote}
            >
              {noteSaving ? 'Saving…' : 'Add note'}
            </Button>
          </div>
        </div>
      </PanelSection>

      {/* Activity */}
      <PanelSection
        id="facts-activity"
        title="Activity"
        open={open.activity}
        onToggle={() => toggle('activity')}
        hint={activity[0] ? formatDate(activity[0].created_at) : undefined}
      >
        <PanelActivity activity={activity} onOpenTab={() => onOpenTab('history')} />
      </PanelSection>

      </>}
      {saveStatus && (
        <p
          role={error ? 'alert' : 'status'}
          className={cn('px-1 text-micro', error ? 'text-red-strong' : 'text-muted-foreground')}
        >
          {saveStatus}
        </p>
      )}
    </div>
  )
}
