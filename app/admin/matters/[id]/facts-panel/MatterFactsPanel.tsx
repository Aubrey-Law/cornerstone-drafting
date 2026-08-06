'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AddressAutocomplete, type ParsedAddress } from '@/components/address-autocomplete'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { formatAssetCurrency } from '@/lib/assets/format'
import { ageInYearsFromDob, formatDobWithAge, toDateInputValue } from '@/lib/dob'
import { normalizeTargetSigningDate, targetSigningDateInput } from '@/lib/matterDates'
import { PRACTICE_AREA_OPTIONS, normalizePracticeArea } from '@/lib/practiceArea'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { resolveDraftingDate, DRAFTING_DATE_COLUMNS } from '@/lib/matter/draftingDates'
import { EMPTY_PLAN_MIRROR, type MatterPlanMirror } from '@/lib/matter/planMirror'
import { isCoupleMatter, MATTER_TYPE_OPTIONS, normalizeMatterType } from '@/lib/matter/matterType'
import {
  REFERRAL_SOURCE_OPTIONS,
  normalizeReferralSource,
  quietDays,
  referralSourceOtherFallback,
} from '@/lib/matter/referralSource'
import { cn, formatDate } from '@/lib/utils'
import type { MatterTab } from '@/lib/matterPageTabs'
import { MARKETING_CONSENT_LABEL, type MarketingConsentStatus } from '@/lib/crm/consent'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import type { MatterActivity, PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { MatterReadinessDial, type MatterReadinessItem } from '../MatterReadinessDial'
import { InlineDate, InlineSelect, InlineText, ReadOnlyRow } from './InlineField'
import { PanelActivity } from './PanelActivity'
import { PanelSection } from './PanelSection'
import { useSectionState } from './useSectionState'

interface ClientRecord {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
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
  date_of_birth: string | null
}

export interface MatterFactsPanelProps {
  matter: PipelineMatter
  matterId: string
  details: MatterDetailsRow | null
  designSheetPlanType: string | null
  /** Design-sheet-owned plan facts, resolved server-side and read-only here. */
  planMirror?: MatterPlanMirror
  /** CRM marketing consent, shown read-only; the Communications tab edits it. */
  marketingConsent?: MarketingConsentStatus
  /** max(communications.created_at) — the quiet chip is derived, never stored. */
  lastContactAt?: string | null
  estate: MatterEstateSnapshot
  /** Kept from the previous rail — the panel must not drop the readiness dial. */
  readinessItems: MatterReadinessItem[]
  activity: MatterActivity[]
  noteText: string
  onNoteTextChange: (value: string) => void
  onAddNote: () => void
  noteSaving: boolean
  noteCount: number
  latestNoteAt: string | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
  savingField: keyof MatterDetailsRow | null
  lastSavedAt: string | null
  error: string | null
  onOpenTab: (tab: MatterTab) => void
}

const MARITAL_OPTIONS = [
  { value: '', label: '—' },
  { value: 'married', label: 'married' },
  { value: 'single', label: 'single' },
  { value: 'widowed', label: 'widowed' },
  { value: 'divorced', label: 'divorced' },
]

const URGENCY_OPTIONS = [
  { value: 'high', label: 'Urgency: high' },
  { value: 'normal', label: 'Urgency: normal' },
  { value: 'low', label: 'Urgency: low' },
]

const FEE_STATUS_OPTIONS = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'deposit', label: 'Deposit' },
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
  matter,
  matterId,
  details,
  designSheetPlanType,
  planMirror = EMPTY_PLAN_MIRROR,
  marketingConsent = 'unknown',
  lastContactAt = null,
  estate,
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
}: MatterFactsPanelProps) {
  const token = useAccessToken()
  const { open, toggle, collapseAll, restored } = useSectionState()
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [addressDraft, setAddressDraft] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingContacts(true)
    void (async () => {
      try {
        const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
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
  }, [matterId, token])

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
        toast.success('Saved', { id: 'matter-panel-save', duration: 1200 })
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : 'Could not save')
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

  const clientName = client?.full_name
    || [client?.first_name, client?.last_name].filter(Boolean).join(' ')
    || matter.client_name
    || matter.matter_name
    || 'Matter'
  const maritalStatus = client?.marital_status ?? matter.marital_status ?? ''
  const dob = client?.date_of_birth ?? matter.client_dob ?? null
  const age = ageInYearsFromDob(dob)
  const cityState = [client?.city, client?.state].filter(Boolean).join(', ')
  const addressValue = addressDraft
    ?? [client?.address_line1, client?.city, client?.state, client?.zip].filter(Boolean).join(', ')

  const practiceArea = normalizePracticeArea(details?.practice_area ?? matter.practice_area)
  const spouseName = [spouse?.first_name, spouse?.last_name].filter(Boolean).join(' ')
    || matter.spouse_name
    || ''
  const spouseDob = spouse?.date_of_birth ?? matter.spouse_dob ?? null
  // Matter type, not marital status, decides whether the spouse surfaces show.
  const isCouple = isCoupleMatter(details, maritalStatus)
  const planLabel = designSheetPlanType || planMirror.planType
    ? designPlanTypeLabel(designSheetPlanType ?? planMirror.planType)
    : '—'
  const county = details?.jurisdiction_county ?? ''
  const referralSource = normalizeReferralSource(details?.referral_source ?? matter.referral_source)
  // Derived from the communications timeline — never a stored last_client_contact.
  const quiet = quietDays(lastContactAt)
  const draftsDue = resolveDraftingDate(details, 'drafts_due')
  const draftsReview = resolveDraftingDate(details, 'drafts_review')
  const revisions = resolveDraftingDate(details, 'revisions')
  const designHref = `/admin/drafting/${matterId}?step=design`
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
    <div className="flex h-full w-full flex-col gap-2.5 overflow-y-auto bg-background p-3">
      {/* Identity */}
      <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-9.5 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-bold text-muted-foreground">
            {initialsFor(clientName) || '—'}
          </div>
          <div className="min-w-0 flex-1">
            <input
              aria-label="Client name"
              defaultValue={clientName}
              key={clientName}
              onBlur={event => {
                const next = event.target.value.trim()
                if (next && next !== clientName) void saveClientField('full_name', next)
              }}
              className="-ml-1.5 h-6.5 w-full rounded-md border border-transparent bg-transparent px-1.5 text-[15px] font-semibold tracking-[-0.012em] outline-none hover:border-input hover:bg-background focus:border-ring focus:bg-background"
            />
            <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              {age !== null && <span className="tabular-nums">{age} ·</span>}
              <select
                aria-label="Marital status"
                value={maritalStatus}
                onChange={event => void saveClientField('marital_status', event.target.value || null)}
                className="h-5.5 rounded border border-transparent bg-transparent px-1 text-[11.5px] text-muted-foreground hover:border-input hover:bg-background focus:border-ring focus:outline-none"
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
            className="h-5.5 rounded-full border border-amber-border bg-amber-bg px-1.5 text-[10.5px] font-semibold text-amber focus:outline-none"
          >
            {URGENCY_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="Fee status"
            value={details?.fee_payment_status ?? (details?.fee_collected ? 'paid_in_full' : 'unpaid')}
            onChange={event => void onSaveField('fee_payment_status', event.target.value)}
            className="h-5.5 rounded-full border border-transparent bg-muted px-1.5 text-[10.5px] font-semibold text-foreground focus:outline-none"
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
            className="h-5.5 rounded-full border border-transparent bg-primary/10 px-1.5 text-[10.5px] font-semibold text-primary focus:outline-none"
          >
            {TAX_DECISION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2.5 text-[10.5px] text-muted-foreground">
          <span>{restored ? 'Sections restored' : 'Sections remember their state'}</span>
          <button
            type="button"
            onClick={collapseAll}
            className="font-semibold text-primary hover:underline"
          >
            Collapse all
          </button>
        </div>
      </div>

      <MatterReadinessDial items={readinessItems} className="rounded-xl border border-border bg-card p-3 shadow-sm" />

      {/* Contact */}
      <PanelSection
        id="facts-contact"
        title="Contact"
        open={open.contact}
        onToggle={() => toggle('contact')}
        hint={!open.contact ? client?.email ?? matter.client_email : undefined}
      >
        {quiet !== null && (
          <div className="px-1.5 pb-1">
            <span
              className={cn(
                'rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold',
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
              value={client?.email ?? matter.client_email ?? ''}
              onSave={next => saveClientField('email', next || null)}
            />
            <InlineText
              label="Phone"
              tabular
              value={client?.phone ?? matter.client_phone ?? ''}
              onSave={next => saveClientField('phone', next || null)}
            />
            <div className="flex items-start justify-between gap-2.5 rounded-md px-1.5 py-1">
              <span className="pt-1.5 text-[11.5px] text-muted-foreground">Address</span>
              <div className="w-52">
                <AddressAutocomplete
                  value={addressValue}
                  onChange={setAddressDraft}
                  onPlaceSelected={(parsed: ParsedAddress) => {
                    setAddressDraft(null)
                    void patchContacts(
                      {
                        target: 'client',
                        patch: {
                          address_line1: parsed.address_line1,
                          city: parsed.city,
                          state: parsed.state,
                          zip: parsed.zip,
                        },
                      },
                      () => setClient(current => (current ? { ...current, ...parsed } : current)),
                    )
                  }}
                  className="h-7 text-[12.5px]"
                />
              </div>
            </div>
            <InlineDate
              label="Date of birth"
              value={toDateInputValue(dob)}
              onSave={next => saveClientField('date_of_birth', next || null)}
            />
            {dob && (
              <p className="px-1.5 text-right text-[11px] text-muted-foreground tabular-nums">
                {formatDobWithAge(dob)}
              </p>
            )}
            <InlineText
              label="County"
              value={county}
              onSave={next => onSaveField('jurisdiction_county', next)}
            />
            <ReadOnlyRow label="Minor children" onClick={() => onOpenTab('people')}>
              {minorChildrenLabel(children, client?.has_minor_children ?? matter.has_minor_children)}
            </ReadOnlyRow>
            {/* Consent belongs to the CRM profile; the Communications tab edits it. */}
            <ReadOnlyRow label="Consent" onClick={() => onOpenTab('communications')}>
              {MARKETING_CONSENT_LABEL[marketingConsent]}
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
                value={spouse.email ?? matter.spouse_email ?? ''}
                onSave={next => saveSpouseField('email', next || null)}
              />
              <InlineText
                label="Phone"
                tabular
                value={spouse.phone ?? matter.spouse_phone ?? ''}
                onSave={next => saveSpouseField('phone', next || null)}
              />
              <InlineDate
                label="Date of birth"
                value={toDateInputValue(spouseDob)}
                onSave={next => saveSpouseField('date_of_birth', next || null)}
              />
              {spouseDob && (
                <p className="px-1.5 text-right text-[11px] text-muted-foreground tabular-nums">
                  {formatDobWithAge(spouseDob)}
                </p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onOpenTab('people')}
              className="px-1.5 text-[11.5px] text-primary hover:underline"
            >
              Add a spouse on the People tab
            </button>
          )}
        </PanelSection>
      )}

      {/* Matter details */}
      <PanelSection
        id="facts-matter"
        title="Matter details"
        open={open.matter}
        onToggle={() => toggle('matter')}
        hint={
          <Link
            href={`/admin/drafting/${matterId}?step=design`}
            className="font-semibold text-primary hover:underline"
            onClick={event => event.stopPropagation()}
          >
            Open design
          </Link>
        }
      >
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

        {/* Same snapshot the Assets tab renders — one computation, two surfaces. */}
        <div className="mx-1.5 mt-1.5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <div className="bg-card px-2.5 py-2">
            <div className="text-[10.5px] text-muted-foreground">Gross estate est.</div>
            <div className="mt-px text-[15px] font-bold tracking-[-0.016em] tabular-nums">
              {formatAssetCurrency(estate.grossEstateEstimate)}
            </div>
          </div>
          <div className="bg-amber-bg px-2.5 py-2">
            <div className="text-[10.5px] text-amber">Estimated MA tax</div>
            <div className="mt-px text-[15px] font-bold tracking-[-0.016em] text-amber tabular-nums">
              {formatAssetCurrency(estate.estimatedMaTax)}
            </div>
          </div>
          <div className="bg-card px-2.5 py-2">
            <div className="text-[10.5px] text-muted-foreground">With credit shelter</div>
            <div className="mt-px text-[15px] font-bold tracking-[-0.016em] tabular-nums">
              {formatAssetCurrency(estate.maTaxWithCreditShelter)}
            </div>
          </div>
          <div className="bg-card px-2.5 py-2">
            <div className="text-[10.5px] text-muted-foreground">Difference</div>
            <div className="mt-px text-[15px] font-bold tracking-[-0.016em] text-green tabular-nums">
              {formatAssetCurrency(estate.creditShelterSavings)}
            </div>
          </div>
        </div>

        <div className="mx-1.5 mt-2">
          <InlineText
            label="Flat fee"
            tabular
            value={
              details?.flat_fee_amount == null
                ? matter.fee_amount == null ? '' : String(matter.fee_amount)
                : String(details.flat_fee_amount)
            }
            onSave={next => onSaveField('flat_fee_amount', next ? Number(next.replace(/[^0-9.]/g, '')) : null)}
          />
        </div>
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
              'rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold',
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
        <ReadOnlyRow label="Trust name">
          {planMirror.trustName ? (
            <Link href={designHref} className="font-semibold text-primary hover:underline">
              {planMirror.trustName}
            </Link>
          ) : (
            '—'
          )}
        </ReadOnlyRow>
        <InlineSelect
          label="Matter type"
          accent
          value={normalizeMatterType(details?.matter_type) ?? (isCouple ? 'couple' : 'individual')}
          options={MATTER_TYPE_OPTIONS}
          onSave={next => onSaveField('matter_type', next)}
        />
        <ReadOnlyRow label="County">{county || '—'}</ReadOnlyRow>
        <p className="px-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">
          Matter type — not marital status — decides whether the spouse section and
          second-death provisions appear. Trust name, plan and credit shelter are
          read-only mirrors of the design sheet.
        </p>
      </PanelSection>

      {/* Dates */}
      <PanelSection
        id="facts-dates"
        title="Dates"
        open={open.dates}
        onToggle={() => toggle('dates')}
        hint={
          details?.scheduled_signing_date
            ? `Signing ${formatDate(details.scheduled_signing_date)}`
            : undefined
        }
      >
        <InlineDate
          label="Engagement signed"
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
          value={toDateInputValue(details?.design_meeting_date ?? null)}
          onSave={next => onSaveField('design_meeting_date', next || null)}
        />
        {/* Drafts due has no column — it is derived from target signing or nothing. */}
        <ReadOnlyRow label="Drafts due">
          <span className="tabular-nums">
            {draftsDue.value ? formatDate(draftsDue.value) : '—'}
          </span>
          {draftsDue.derived && (
            <span className="text-[9.5px] font-semibold uppercase tracking-[.05em] text-primary">
              auto
            </span>
          )}
        </ReadOnlyRow>
        <InlineDate
          label="Drafts review"
          derived={draftsReview.derived}
          value={draftsReview.value}
          onSave={next => onSaveField(DRAFTING_DATE_COLUMNS.drafts_review!, next || null)}
        />
        <InlineDate
          label="Revisions"
          derived={revisions.derived}
          value={revisions.value}
          onSave={next => onSaveField(DRAFTING_DATE_COLUMNS.revisions!, next || null)}
        />
        <InlineDate
          label="Plan signed"
          value={toDateInputValue(details?.signing_date ?? matter.signing_date ?? null)}
          onSave={next => onSaveField('signing_date', next || null)}
        />
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
            className="text-[12.5px]"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2.5">
            <span className="text-[11px] text-muted-foreground">Saves on blur</span>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11.5px]"
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
        <PanelActivity activity={activity} onOpenTab={() => onOpenTab('activity')} />
      </PanelSection>

      {saveStatus && (
        <p
          role={error ? 'alert' : 'status'}
          className={cn('px-1 text-[11px]', error ? 'text-red-strong' : 'text-muted-foreground')}
        >
          {saveStatus}
        </p>
      )}
    </div>
  )
}
