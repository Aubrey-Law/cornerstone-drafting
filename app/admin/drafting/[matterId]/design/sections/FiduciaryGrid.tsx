'use client'

import { useEffect, useState } from 'react'
import { ArrowLeftRight, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { designPlanTypeIncludesTrust } from '@/lib/designPlanType'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import { cn } from '@/lib/utils'
import type { DesignSheet, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'
import {
  CLIENT_SLOT_FIELDS,
  spouseSlotFields,
  cloneSlots,
  findClientContact,
  findSpouseContact,
  SPOUSE_SLOT_FIELDS,
  isMarriedSheet,
  partyFullName,
  PartyTabs,
  resolveSlotContactIds,
  SHARED_SLOT_FIELDS,
  type FiduciaryGridRole,
  type FiduciaryPartyRole,
  type FiduciarySharedRole,
  type FiduciarySlotField,
} from './fiduciary-blocks'
import {
  createSlot,
  firstAvailablePrincipalOrder,
  coSlotsForOrder,
  movePrincipalSlot,
  removeFiduciaryContact,
  repairFiduciarySlotOrdering,
  normalizeFiduciarySlots,
  ROLE_CONFIG,
  type RoleConfig,
} from './fiduciary-helpers'
import type { DesignSheetOnChange } from './shared'

type RoleDef<T extends string> = { id: T; label: string; document: string }

/** Appointed per person — each spouse names their own. */
const PARTY_ROLES: Array<RoleDef<FiduciaryPartyRole>> = [
  { id: 'trustee', label: 'Successor trustee', document: 'Trust' },
  { id: 'executor', label: 'Personal representative', document: 'Will' },
  { id: 'poa', label: 'Financial POA agent', document: 'Durable POA' },
  { id: 'hcp', label: 'Health care agent', document: 'HCP' },
]

/**
 * Appointed for the children, not for a parent: both spouses name the same people
 * in their own wills. Rendered once, outside the party tabs.
 */
const SHARED_ROLES: Array<RoleDef<FiduciarySharedRole>> = [
  { id: 'guardian', label: 'Guardian', document: 'Will / appointment' },
  { id: 'temporary_guardian', label: 'Temporary guardian', document: 'Parental delegation' },
]

function namedPrincipals(slots: FiduciarySlot[]): FiduciarySlot[] {
  // Repair (not just normalize) so a stored empty placeholder slot can never
  // shift the displayed line of succession — the first appointee is "1st".
  return repairFiduciarySlotOrdering(slots)
    .filter(slot => !slot.is_co && Boolean(slot.contact_id))
    .sort((a, b) => a.order - b.order)
}

function orderLabel(order: number): string {
  const next = order + 1
  if (next === 1) return '1st'
  if (next === 2) return '2nd'
  if (next === 3) return '3rd'
  return `${next}th`
}

function roleConfigFor(role: FiduciaryGridRole): RoleConfig {
  return ROLE_CONFIG[role]
}

export function toggleFiduciaryGridContact(
  slots: FiduciarySlot[] | null | undefined,
  contactId: string,
  roleConfig: RoleConfig,
  targetOrder?: number,
): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots ?? [])
  const existing = normalized.filter(slot => slot.contact_id === contactId)
  const finalize = (next: FiduciarySlot[]) => repairFiduciarySlotOrdering(normalizeFiduciarySlots(next))

  if (existing.some(slot => !slot.is_co)) {
    // Plain removal: everyone below moves up one line. The old path promoted
    // the next principal into the (possibly empty) first slot while their own
    // slot kept the id, duplicating the appointment.
    return removeFiduciaryContact(normalized, contactId)
  }

  const existingCoSlot = existing.find(slot => slot.is_co)
  if (existingCoSlot) {
    return finalize(normalized.filter(slot => slot.id !== existingCoSlot.id))
  }

  if (targetOrder != null) {
    if (!roleConfig.allowCo) {
      const nextOrder = firstAvailablePrincipalOrder(normalized)
      return finalize([
        ...normalized,
        { ...createSlot(nextOrder), contact_id: contactId },
      ])
    }

    const hasPrincipal = normalized.some(slot => !slot.is_co && slot.order === targetOrder && slot.contact_id)
    const openOnTarget = coSlotsForOrder(normalized, targetOrder).filter(slot => slot.contact_id).length < roleConfig.maxCo
    if (!hasPrincipal || !openOnTarget) {
      return normalized
    }

    return finalize([
      ...normalized,
      { ...createSlot(targetOrder, true), contact_id: contactId },
    ])
  }

  // No co line was targeted, so this is a plain add: the next person named for
  // a role is their successor, not someone serving alongside the first.
  //
  // This path used to fill open co slots first, which meant clicking a second
  // contact silently produced a co-trustee — and for roles with maxCo 3, three
  // co-fiduciaries before anyone became an alternate. It reached the drafted
  // documents as `dpoa_co_agent` / `guardian_co` / `hcp_co` where the design
  // sheet meant `_successor`, so a document named someone to serve jointly when
  // the attorney intended them to serve only if the first could not.
  //
  // Serving jointly is a deliberate choice, and the grid already has explicit
  // "Pair with <line>" controls for it — those pass targetOrder and are handled
  // above. Clicking a contact never creates one.
  const nextOrder = firstAvailablePrincipalOrder(normalized)
  return finalize([
    ...normalized,
    { ...createSlot(nextOrder), contact_id: contactId },
  ])
}

export function mirrorReversedFiduciarySlots(
  slots: FiduciarySlot[] | null | undefined,
  clientContactId: string | null,
  spouseContactId: string | null,
): FiduciarySlot[] {
  const mirrored = cloneSlots(slots).map(slot => {
    if (clientContactId && slot.contact_id === clientContactId) {
      return { ...slot, contact_id: spouseContactId }
    }
    if (spouseContactId && slot.contact_id === spouseContactId) {
      return { ...slot, contact_id: clientContactId }
    }
    return slot
  })
  return normalizeFiduciarySlots(mirrored)
}

function contactName(contact: MatterContact): string {
  return [contact.first_name, contact.middle_name, contact.last_name, contact.suffix]
    .filter(Boolean)
    .join(' ')
}

export function FiduciaryGrid({
  sheet,
  contacts,
  matter,
  onChange,
  showInapplicable = false,
  flashRoleKey = null,
}: {
  sheet: DesignSheet
  contacts: MatterContact[]
  matter: PipelineMatter
  onChange: DesignSheetOnChange
  showInapplicable?: boolean
  /** Slot field to flash (readiness blocker target); tints that role's column briefly. */
  flashRoleKey?: FiduciarySlotField | null
}) {
  const married = isMarriedSheet(sheet)
  const [party, setParty] = useState<'client' | 'spouse'>('client')
  const [flashField, setFlashField] = useState<FiduciarySlotField | null>(null)

  useEffect(() => {
    if (!flashRoleKey) return
    setParty(flashRoleKey.startsWith('spouse_') ? 'spouse' : 'client')
    setFlashField(flashRoleKey)
    const timer = window.setTimeout(() => setFlashField(null), 1600)
    return () => window.clearTimeout(timer)
  }, [flashRoleKey])
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = married ? findSpouseContact(contacts, matter, sheet) : null
  const spouseFields = spouseSlotFields(sheet)
  const slotFields = party === 'spouse' ? spouseFields : CLIENT_SLOT_FIELDS
  const inclusions = getDocumentInclusions(sheet)
  const hasMinorChildren = sheetHasMinorChildren(sheet.children)
  const requiredRoles = new Set<FiduciaryGridRole>([
    ...(inclusions.trust ? ['trustee' as const] : []),
    ...(inclusions.will ? ['executor' as const] : []),
    ...(inclusions.dpoa ? ['poa' as const] : []),
    ...(inclusions.healthcare ? ['hcp' as const] : []),
    ...(inclusions.will && hasMinorChildren ? ['guardian' as const] : []),
  ])
  const displayedRoles = PARTY_ROLES
    .map(role => ({
      ...role,
      applicable: role.id !== 'trustee' || designPlanTypeIncludesTrust(sheet.plan_type),
    }))
    .filter(role => showInapplicable || role.applicable)
  // A temporary guardian only delegates care of a minor, so it is offered when
  // there are minor children. It is never a drafting blocker — see designSheetReadiness.
  const displayedSharedRoles = SHARED_ROLES
    .map(role => ({
      ...role,
      applicable: role.id !== 'temporary_guardian' || hasMinorChildren,
    }))
    .filter(role => showInapplicable || role.applicable)

  const syntheticContacts = [clientContact, spouseContact].filter(
    (contact): contact is MatterContact => Boolean(contact),
  )
  const roster = [...syntheticContacts, ...contacts]
    .filter((contact, index, all) => (
      Boolean(contact.id)
      && all.findIndex(candidate => candidate.id === contact.id) === index
      && contact.id !== (party === 'client' ? clientContact?.id : spouseContact?.id)
    ))

  // Names for the succession lists — unlike the roster, this includes the
  // current party's own person, since other flows can appoint them (e.g. the
  // client as their own initial trustee).
  const contactNameById = new Map(
    [...syntheticContacts, ...contacts].map(contact => [contact.id, contactName(contact)]),
  )

  const writeSlots = (field: FiduciarySlotField, updater: (slots: FiduciarySlot[]) => FiduciarySlot[]) => {
    onChange(field, previousSheet => {
      const current = (previousSheet[field] as FiduciarySlot[] | null) ?? []
      const resolved = resolveSlotContactIds(current, clientContact, spouseContact)
      return repairFiduciarySlotOrdering(
        normalizeFiduciarySlots(updater(resolved)),
      ) as DesignSheet[typeof field]
    })
  }

  const mirrorToOtherParty = () => {
    const targetFields = party === 'client' ? spouseFields : CLIENT_SLOT_FIELDS
    for (const role of PARTY_ROLES) {
      const sourceField = slotFields[role.id]
      const targetField = targetFields[role.id]
      if (sourceField === targetField) continue
      const source = (sheet[sourceField] as FiduciarySlot[] | null) ?? []
      onChange(targetField, repairFiduciarySlotOrdering(
        mirrorReversedFiduciarySlots(
          resolveSlotContactIds(source, clientContact, spouseContact),
          clientContact?.id ?? null,
          spouseContact?.id ?? null,
        ),
      ) as DesignSheet[typeof targetField])
    }
    setParty(current => current === 'client' ? 'spouse' : 'client')
  }

  useEffect(() => {
    const allFields = new Set<FiduciarySlotField>([
      ...Object.values(CLIENT_SLOT_FIELDS),
      ...Object.values(SHARED_SLOT_FIELDS),
      ...(sheet.is_joint === false ? Object.values(SPOUSE_SLOT_FIELDS) : []),
    ])

    for (const field of allFields) {
      const current = (sheet[field] as FiduciarySlot[] | null) ?? []
      const repaired = repairFiduciarySlotOrdering(current)
      if (JSON.stringify(current) === JSON.stringify(repaired)) continue
      onChange(field, repaired as DesignSheet[typeof field])
    }
  }, [sheet, onChange])

  return (
    <div className="space-y-4">
      {married ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[320px] flex-1">
            <PartyTabs
              value={party}
              onChange={setParty}
              clientLabel={partyFullName(sheet, matter, 'client')}
              spouseLabel={partyFullName(sheet, matter, 'spouse')}
            />
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={mirrorToOtherParty}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Mirror reversed
          </Button>
        </div>
      ) : null}

      <RoleMatrix
        roles={displayedRoles}
        slotFields={slotFields}
        sheet={sheet}
        roster={roster}
        contactNameById={contactNameById}
        requiredRoles={requiredRoles}
        scopeResetKey={party}
        flashField={flashField}
        writeSlots={writeSlots}
      />

      {displayedSharedRoles.length > 0 ? (
        <div className="space-y-2">
          <div>
            <p className="text-xs font-semibold text-foreground">For the children</p>
            <p className="text-[11px] text-muted-foreground">
              {married
                ? 'Named once — both wills appoint the same guardians.'
                : 'Named in the will.'}
            </p>
          </div>
          <RoleMatrix
            roles={displayedSharedRoles}
            slotFields={SHARED_SLOT_FIELDS}
            sheet={sheet}
            roster={roster}
            contactNameById={contactNameById}
            requiredRoles={requiredRoles}
            scopeResetKey={party}
            flashField={flashField}
            writeSlots={writeSlots}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Contacts down the side, roles across the top, one toggle per cell. Rendered once
 * for the per-party roles and again for the shared child-related roles, which is
 * why it takes its roles and slot fields rather than reading them from the sheet.
 */
function RoleMatrix<T extends FiduciaryGridRole>({
  roles,
  slotFields,
  sheet,
  roster,
  contactNameById,
  requiredRoles,
  scopeResetKey,
  flashField,
  writeSlots,
}: {
  roles: Array<{ id: T; label: string; document: string; applicable: boolean }>
  slotFields: Record<T, FiduciarySlotField>
  sheet: DesignSheet
  roster: MatterContact[]
  contactNameById: Map<string, string>
  requiredRoles: Set<FiduciaryGridRole>
  scopeResetKey?: string
  flashField: string | null
  writeSlots: (field: FiduciarySlotField, updater: (slots: FiduciarySlot[]) => FiduciarySlot[]) => void
}) {
  type CoTarget = { role: T; order: number }
  const [targetedCo, setTargetedCo] = useState<CoTarget | null>(null)

  useEffect(() => {
    setTargetedCo(null)
  }, [scopeResetKey])

  // Must sit below the hooks. Above them, the hook call order depends on
  // `roles`, and React throws "Rendered more hooks than during the previous
  // render" the first time that array goes from empty to populated.
  if (roles.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div
        className="grid min-w-[648px]"
        style={{ gridTemplateColumns: `168px repeat(${roles.length}, minmax(96px, 1fr))` }}
      >
        <div className="border-b border-r border-border bg-muted/40 p-3 text-xs font-semibold text-foreground">
          Contact roster
        </div>
        {roles.map(role => {
          const slots = (sheet[slotFields[role.id]] as FiduciarySlot[] | null) ?? []
          const roleConfig = roleConfigFor(role.id)
          const principalSlots = namedPrincipals(slots)
          const coTargets = principalSlots.map(slot => {
            const activeCo = coSlotsForOrder(slots, slot.order).filter(entry => entry.contact_id).length
            return {
              order: slot.order,
              openCo: activeCo,
              hasOpenCoSlot: activeCo < roleConfig.maxCo,
            }
          })
          const count = principalSlots.length
          const required = requiredRoles.has(role.id)
          const status = count === 0 ? 'Not named' : count === 1 ? 'No alternate' : `${count} in line`
          const flashing = flashField != null && flashField === slotFields[role.id]
          const targetedOrder = targetedCo?.role === role.id ? targetedCo.order : null
          return (
            <div
              key={role.id}
              id={designFieldTargetId(String(slotFields[role.id]))}
              tabIndex={-1}
              className={cn(
                'border-b border-r border-border p-2 last:border-r-0',
                flashing ? 'bg-warning/10' : 'bg-muted/40',
                !role.applicable && 'opacity-45 grayscale-[20%]',
              )}
            >
              <p className="text-[11px] font-semibold leading-tight text-foreground">{role.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{role.document}</p>
              <span className={cn(
                'mt-2 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                count === 0 && required
                ? 'border-[var(--gi-amber-border)] bg-[var(--gi-amber-bg)] text-[var(--gi-amber)]'
                : count === 1
                  ? 'border-border bg-card text-muted-foreground'
                  : 'border-[var(--gi-teal)] bg-[color-mix(in_srgb,var(--gi-teal)_12%,transparent)] text-[var(--gi-teal)]',
              )}>
                {status}
              </span>
              {principalSlots.length > 0 ? (
                <ol className="mt-2 space-y-1">
                  {principalSlots.map((slot, index) => {
                    const contactId = slot.contact_id
                    if (!contactId) return null
                    const name = contactNameById.get(contactId) ?? 'Contact'
                    const field = slotFields[role.id]
                    const reorder = (delta: -1 | 1) => {
                      writeSlots(field, current => movePrincipalSlot(current, contactId, delta))
                      setTargetedCo(null)
                    }
                    return (
                      <li key={slot.id} className="flex items-center gap-1">
                        <span className="w-6 shrink-0 text-[9px] font-semibold text-muted-foreground">
                          {orderLabel(index)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[10px] text-foreground" title={name}>
                          {name}
                        </span>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => reorder(-1)}
                          aria-label={`Move ${name} up in ${role.label} succession`}
                          title="Move up"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={index === principalSlots.length - 1}
                          onClick={() => reorder(1)}
                          aria-label={`Move ${name} down in ${role.label} succession`}
                          title="Move down"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            writeSlots(field, current => removeFiduciaryContact(current, contactId))
                            setTargetedCo(null)
                          }}
                          aria-label={`Remove ${name} as ${role.label}`}
                          title="Remove"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : null}
              {roleConfig.allowCo ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {coTargets.length === 0 ? (
                    <span className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[8px] text-muted-foreground">
                      Pick a line to pair first
                    </span>
                  ) : (
                    coTargets.map(({ order, openCo, hasOpenCoSlot }) => (
	                      <button
                        type="button"
                        key={order}
                        disabled={!hasOpenCoSlot && targetedOrder !== order}
                        onClick={() => {
                          setTargetedCo(current => (
                            current?.role === role.id && current?.order === order
                              ? null
                              : { role: role.id, order }
                          ))
                        }}
                        className={cn(
                          'rounded-full border px-1.5 py-0.5 text-[8px] transition-colors',
                          targetedOrder === order
                            ? 'border-[var(--gi-teal)] bg-[color-mix(in_srgb,var(--gi-teal)_12%,transparent)] text-[var(--gi-teal)]'
                            : hasOpenCoSlot
                              ? 'border-border bg-card text-muted-foreground hover:border-[var(--gi-teal)] hover:text-[var(--gi-teal)]'
                              : 'border-border bg-muted text-muted-foreground/70',
                          !hasOpenCoSlot && targetedOrder !== order && 'cursor-not-allowed',
                        )}
                        title={hasOpenCoSlot
                          ? `Pair with ${orderLabel(order)} (${openCo}/${roleConfig.maxCo})`
                          : `No open co-agent slot on ${orderLabel(order)} (${openCo}/${roleConfig.maxCo})`}
                      >
                        Pair with {orderLabel(order)} ({openCo}/{roleConfig.maxCo})
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              {roleConfig.allowCo ? (
                <p className="mt-1.5 text-[8px] text-muted-foreground">
                  {`Co max per line: ${roleConfig.maxCo}`}
                </p>
              ) : null}
              {targetedOrder != null && (
                <div className="mt-1.5 rounded border border-dashed border-[var(--gi-teal)] px-1.5 py-0.5 text-[9px] text-[var(--gi-teal)]">
                  <span>Target line: {orderLabel(targetedOrder)}</span>
                  <button
                    type="button"
                    onClick={() => setTargetedCo(null)}
                    className="ml-2 inline-flex items-center rounded-sm border border-[var(--gi-teal)]/35 px-1 py-0 text-[8px] text-[var(--gi-teal)] hover:bg-[color-mix(in_srgb,var(--gi-teal)_10%,transparent)]"
                    aria-label="Clear target line"
                    title="Clear target line"
                  >
                    <X className="mr-0.5 h-2 w-2" /> Clear
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {roster.map(contact => (
          <div key={contact.id} className="contents">
            <div className="border-b border-r border-border p-3">
              <p className="truncate text-xs font-medium text-foreground">{contactName(contact)}</p>
              <p className="truncate text-[10px] text-muted-foreground">{contact.relationship || 'Contact'}</p>
            </div>
            {roles.map(role => {
              const field = slotFields[role.id]
              const slots = (sheet[field] as FiduciarySlot[] | null) ?? []
              const principalSlots = namedPrincipals(slots)
              const matchingPrincipalSlot = principalSlots.find(slot => slot.contact_id === contact.id)
              const principalOrder = matchingPrincipalSlot?.order ?? null
              const isPrincipal = principalOrder != null
              const coSlot = slots.find(slot => slot.is_co && slot.contact_id === contact.id)
              const isCo = coSlot != null
              const roleConfig = roleConfigFor(role.id)
              const selected = isPrincipal || isCo
              const coForThisRole = targetedCo?.role === role.id ? targetedCo.order : null
              const targetLineHasPrincipal = coForThisRole != null
                && principalSlots.some(slot => slot.order === coForThisRole && Boolean(slot.contact_id))
              const targetLineOpenCo = coForThisRole != null
                && coSlotsForOrder(slots, coForThisRole).filter(entry => entry.contact_id).length < roleConfig.maxCo
              const targetLineReadyForCo = coForThisRole != null && roleConfig.allowCo && targetLineHasPrincipal && targetLineOpenCo
              const targetingThisCell = targetLineReadyForCo && principalOrder != null && coForThisRole === principalOrder
              const selectedTargetOrder = targetLineReadyForCo && !selected ? coForThisRole : null
              const flashing = flashField != null && flashField === field
              const label = isPrincipal
                ? orderLabel(principalOrder)
                : isCo
                  ? roleConfig.coLabel
                  : ''
              const targetOrderLabel = selectedTargetOrder != null ? orderLabel(selectedTargetOrder) : null
              return (
                <button
                  key={role.id}
                  type="button"
                  aria-label={
                    `${selected ? 'Remove' : 'Add'} ${contactName(contact)} ${
                      selected
                        ? role.label
                        : targetOrderLabel
                          ? `${roleConfig.coLabel.toLowerCase()} for ${targetOrderLabel}`
                          : role.label
                    }`
                  }
                  aria-pressed={selected}
                  onClick={() => {
                    const targetOrder = selectedTargetOrder
                    writeSlots(field, current => toggleFiduciaryGridContact(
                      current,
                      contact.id,
                      roleConfig,
                      targetOrder ?? undefined,
                    ))
                    if (selected && targetingThisCell) setTargetedCo(null)
                    if (!selected && selectedTargetOrder != null) setTargetedCo(null)
                  }}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center border-b border-r border-border p-2 text-center last:border-r-0',
                    isPrincipal
                      ? 'bg-[color-mix(in_srgb,var(--gi-teal)_12%,transparent)] text-[var(--gi-teal)]'
                      : isCo
                        ? 'border-[var(--gi-teal)]/35 bg-[color-mix(in_srgb,var(--gi-teal)_8%,transparent)] text-[var(--gi-teal)]'
                        : flashing
                          ? 'bg-warning/10 text-muted-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted/40',
                    targetingThisCell && 'ring-2 ring-[var(--gi-teal)]',
                    !role.applicable && 'opacity-45 grayscale-[20%]',
                  )}
                >
                  {isPrincipal ? (
                    <span className="rounded-full border border-[var(--gi-teal)] px-1.5 py-1 text-[10px] font-semibold">
                      {targetingThisCell ? `${label} • co` : label}
                    </span>
                  ) : isCo ? (
                    <span className="rounded-full border border-[var(--gi-teal)] px-1.5 py-1 text-[10px] font-semibold">
                      {label}
                    </span>
                  ) : selectedTargetOrder == null ? (
                    <Plus className="h-4 w-4" />
                  ) : (
                    <span className="text-[10px] font-semibold">+{roleConfig.coLabel}</span>
                  )}
                  {isPrincipal && roleConfig.allowCo && (
                    <span className="mt-0.5 text-[8px] text-muted-foreground">
                      {targetingThisCell ? 'Line targeted' : 'Use “Pair with” to choose a line'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}

      </div>
    </div>
  )
}
