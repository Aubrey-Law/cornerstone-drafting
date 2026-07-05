'use client'

import { useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import type { DesignSheet, MatterContact, FiduciarySlot, FiduciaryRole } from '@/types/database'
import type { SlotState } from '@/types/planReview'
import { AttorneyNoteBanner, AttorneySelect, FieldLabel, SectionBlock, SlotStateToggle } from './shared'
import { cn } from '@/lib/utils'
import { sheetHasMinorChildren, sheetMinorChildren } from '@/lib/designSheet/minorChildren'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { PipelineMatter } from '@/types/database'
import {
  cloneSlots,
  findClientContact,
  FiduciaryBlock,
  isMarriedSheet,
} from './fiduciary-blocks'
import type { SectionProps } from './shared'
import ContactPicker from './ContactPicker'
import type { Contact } from './ContactPicker'
import {
  addAlternate,
  removeAlternate,
  addCo,
  removeCo,
  removeCoForOrder,
  setSlotContact,
  slotsByOrder,
  ROLE_CONFIG,
} from './fiduciary-helpers'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function contactById(contacts: MatterContact[], id: string | null, extraContacts: Contact[] = []): Contact | null {
  if (!id) return null
  const c = [...extraContacts, ...contacts].find(x => x.id === id)
  return c ? (c as Contact) : null
}

const SLOT_FIELDS: Record<FiduciaryRole, keyof DesignSheet> = {
  trustee: 'trustee_slots',
  executor: 'executor_slots',
  poa: 'poa_slots',
  hcp: 'hcp_slots',
  guardian: 'guardian_slots',
  temporary_guardian: 'temporary_guardian_slots',
}

// ── FiduciaryRoleSection ─────────────────────────────────────────────────────

export function FiduciaryRoleSection({
  role,
  slots,
  contacts,
  onSlotsChange,
  onAddContact,
  onUpdateContact,
  slotStates,
  onSlotStateChange,
  sameAsTrustee,
  onSameAsTrusteeToggle,
  sameAsTrusteeLabel,
  spouseContact,
  spouseOptionLabel,
  primaryShortcutContact,
  primaryShortcutLabel,
  clientContact,
  clientOptionLabel,
  coShortcutContact,
  coShortcutLabel,
  title,
}: {
  role: FiduciaryRole
  slots: FiduciarySlot[]
  contacts: MatterContact[]
  onSlotsChange: (slots: FiduciarySlot[]) => void
  onAddContact: (data: Omit<Contact, 'id'>) => Promise<Contact>
  onUpdateContact?: (id: string, data: Omit<Contact, 'id'>) => Promise<Contact>
  slotStates: Record<string, SlotState> | null
  onSlotStateChange: (slotId: string, state: SlotState) => void
  sameAsTrustee?: boolean
  onSameAsTrusteeToggle?: () => void
  sameAsTrusteeLabel?: string
  spouseContact?: Contact | null
  spouseOptionLabel?: string
  primaryShortcutContact?: Contact | null
  primaryShortcutLabel?: string
  clientContact?: Contact | null
  clientOptionLabel?: string
  coShortcutContact?: Contact | null
  coShortcutLabel?: string
  title?: string
}) {
  const config = ROLE_CONFIG[role]
  const groups = slotsByOrder(slots)
  const primarySlot = groups.find(group => group.principal.order === 0)?.principal ?? null
  const primaryGroup = groups.find(group => group.principal.order === 0) ?? null

  // One checkbox per "set this person as primary" shortcut, de-duplicated by id
  // so the same contact never shows twice. Each toggles the primary slot.
  const seenShortcut = new Set<string>()
  const primaryShortcuts = ([
    primaryShortcutContact ? { contact: primaryShortcutContact, label: primaryShortcutLabel } : null,
    clientContact ? { contact: clientContact, label: clientOptionLabel } : null,
    spouseContact ? { contact: spouseContact, label: spouseOptionLabel } : null,
  ].filter(Boolean) as { contact: Contact; label?: string }[])
    .filter(s => {
      if (!s.contact?.id || seenShortcut.has(s.contact.id)) return false
      seenShortcut.add(s.contact.id)
      return true
    })

  const coContact = config.allowCo ? coShortcutContact ?? null : null
  const shortcutCoSlot = coContact
    ? primaryGroup?.coSlots.find(slot => slot.contact_id === coContact.id) ?? null
    : null
  const coIsShortcut = Boolean(shortcutCoSlot)
  const handleCoShortcutToggle = (checked: boolean) => {
    if (!coContact || !primaryGroup) return
    if (checked) {
      const withCo = addCo(slots, 0)
      const coSlot = [...withCo].reverse().find(s => s.order === 0 && s.is_co && !s.contact_id)
      onSlotsChange(coSlot ? setSlotContact(withCo, coSlot.id, coContact.id) : withCo)
    } else {
      onSlotsChange(shortcutCoSlot ? removeCo(slots, shortcutCoSlot.id) : removeCoForOrder(slots, 0))
    }
  }

  const extraContacts = [...primaryShortcuts.map(s => s.contact), ...(coContact ? [coContact] : [])]
    .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)

  return (
    <SectionBlock title={title ?? config.title}>
      {/* "Same as Trustees" checkbox for executor / poa */}
      {sameAsTrustee !== undefined && onSameAsTrusteeToggle && (
        <div className="mb-4 flex items-center gap-2">
          <Checkbox
            checked={sameAsTrustee}
            onCheckedChange={onSameAsTrusteeToggle}
          />
          <span className="text-xs text-foreground">{sameAsTrusteeLabel ?? 'Same as Trustees'}</span>
        </div>
      )}

      {primarySlot && primaryShortcuts.map(s => (
        <div key={s.contact.id} className="mb-4 flex items-center gap-2">
          <Checkbox
            checked={primarySlot.contact_id === s.contact.id}
            onCheckedChange={checked => {
              onSlotsChange(setSlotContact(slots, primarySlot.id, checked ? s.contact.id : null))
            }}
          />
          <span className="text-xs text-foreground">
            {s.label ?? `${s.contact.first_name} as ${config.primaryLabel.toLowerCase()}`}
          </span>
        </div>
      ))}

      {coContact && primaryGroup && (
        <div className="mb-4 flex items-center gap-2">
          <Checkbox
            checked={coIsShortcut}
            onCheckedChange={checked => handleCoShortcutToggle(checked === true)}
          />
          <span className="text-xs text-foreground">
            {coShortcutLabel ?? `Spouse as initial ${config.coLabel.toLowerCase()}`}
          </span>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group, groupIdx) => {
          const isPrimary = group.principal.order === 0
          const label = isPrimary
            ? config.primaryLabel
            : `${config.altLabel} ${group.principal.order}`
          const slotState = (slotStates?.[group.principal.id] ?? 'filled') as SlotState

          return (
            <div key={group.principal.id}>
              {/* Principal slot */}
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="mb-1">
                    <SlotStateToggle
                      slotKey={group.principal.id}
                      state={slotState}
                      onChange={s => onSlotStateChange(group.principal.id, s)}
                    />
                  </div>
                  <ContactPicker
                    role={label}
                    required={isPrimary}
                    value={contactById(contacts, group.principal.contact_id, extraContacts)}
                    onChange={c => onSlotsChange(setSlotContact(slots, group.principal.id, c?.id ?? null))}
                    contacts={[...extraContacts, ...(contacts as Contact[])]}
                    onAddContact={onAddContact}
                    onUpdateContact={onUpdateContact}
                  />
                </div>
                {/* Remove button — only for alternates */}
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onSlotsChange(removeAlternate(slots, group.principal.order))}
                    className="mt-8 rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors"
                    title="Remove alternate"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Co-fiduciary slot (if allowCo) */}
              {config.allowCo && group.coSlots.length > 0 && (
                <div className="ml-8 mt-2 space-y-2 border-l-2 border-border pl-4">
                  {group.coSlots.map((coSlot, coIndex) => (
                    <div key={coSlot.id} className="flex items-start gap-2">
                      <div className="flex-1">
                        <ContactPicker
                          role={`${config.coLabel} ${coIndex + 1} (${isPrimary ? 'Primary' : `Alt ${group.principal.order}`})`}
                          value={contactById(contacts, coSlot.contact_id, extraContacts)}
                          onChange={c => onSlotsChange(setSlotContact(slots, coSlot.id, c?.id ?? null))}
                          contacts={[...extraContacts, ...(contacts as Contact[])]}
                          onAddContact={onAddContact}
                          onUpdateContact={onUpdateContact}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onSlotsChange(removeCo(slots, coSlot.id))}
                        className="mt-6 rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors"
                        title={`Remove ${config.coLabel.toLowerCase()}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* "Add Co-" button when allowCo and the group has room */}
              {config.allowCo && group.coSlots.length < config.maxCo && (
                <div className="ml-8 mt-1.5 pl-4">
                  <button
                    type="button"
                    onClick={() => onSlotsChange(addCo(slots, group.principal.order))}
                    className="flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent/80 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add {config.coLabel}
                  </button>
                </div>
              )}

              {/* Divider between groups */}
              {groupIdx < groups.length - 1 && (
                <div className="mt-4 border-t border-dashed border-border" />
              )}
            </div>
          )
        })}
      </div>

      {/* Add Alternate button */}
      <div className="mt-4 pt-3 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => onSlotsChange(addAlternate(slots))}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Alternate {config.title.split(' / ')[0]}
        </Button>
      </div>
    </SectionBlock>
  )
}

// ── FiduciariesSectionEP ───────────────────────────────────────────────────

export function FiduciariesSectionEP({ sheet, contacts, matter, onChange, onAddContact, onUpdateContact }: Props) {
  const ALL_ROLES: FiduciaryRole[] = ['trustee', 'executor', 'poa', 'hcp', 'guardian', 'temporary_guardian']
  const inclusions = getDocumentInclusions(sheet)
  const married = isMarriedSheet(sheet)
  const spouseDocs = married && inclusions.spouse_docs
  const separateTrusts = married && sheet.is_joint === false
  const clientContact = findClientContact(contacts, matter, sheet)
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseTrusteeSource = separateTrusts ? sheet.spouse_trustee_slots : sheet.trustee_slots
  const blockProps = { sheet, contacts, matter, onChange, onAddContact, onUpdateContact }

  const minorChildren = sheetMinorChildren(sheet.children)
  const hasMinorChildren = sheetHasMinorChildren(sheet.children)

  // Guardian and Temporary Guardian only apply when there are minor children.
  const ROLES = hasMinorChildren
    ? ALL_ROLES
    : ALL_ROLES.filter(r => r !== 'guardian' && r !== 'temporary_guardian')

  const handleSlotsChange = useCallback((role: FiduciaryRole, slots: FiduciarySlot[]) => {
    onChange(SLOT_FIELDS[role], slots as DesignSheet[keyof DesignSheet])
  }, [onChange])

  const handleSlotStateChange = useCallback((slotId: string, state: SlotState) => {
    onChange('fiduciary_slot_states', {
      ...(sheet.fiduciary_slot_states ?? {}),
      [slotId]: state,
    })
  }, [onChange, sheet.fiduciary_slot_states])

  const handleAddContact = useCallback(async (data: Omit<Contact, 'id'>): Promise<Contact> => {
    const contact = await onAddContact(data as Omit<MatterContact, 'id'>)
    return contact as Contact
  }, [onAddContact])

  const handleUpdateContact = useCallback(async (id: string, data: Omit<Contact, 'id'>): Promise<Contact> => {
    if (!onUpdateContact) throw new Error('Contact updates are not available here')
    const contact = await onUpdateContact(id, data as Omit<MatterContact, 'id'>)
    return contact as Contact
  }, [onUpdateContact])

  return (
    <div>
      <AttorneyNoteBanner>
        Fiduciary selections were pre-filled from the client intake. Review all roles carefully
        and update as needed. Use the slot state toggle to mark pending or optional roles.
      </AttorneyNoteBanner>

      <SectionBlock title="Fiduciary Structure" subtitle="Drives how PR and trustee slots are nominated in the Will">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Personal Representative Structure"
            value={sheet.pr_structure ?? ''}
            placeholder="Select…"
            options={[
              { value: 'single', label: 'Single PR + successor' },
              { value: 'spouse_first', label: 'Spouse first, then successor' },
              { value: 'co_pr', label: 'Co-PRs serving jointly' },
            ]}
            onChange={v => onChange('pr_structure', (v || null) as 'single' | 'spouse_first' | 'co_pr' | null)}
          />
          <AttorneySelect
            label="Trustee Nomination Structure"
            value={sheet.trustee_structure ?? ''}
            placeholder="Select…"
            options={[
              { value: 'single', label: 'Single trustee + successor' },
              { value: 'spouse_first', label: 'Spouse first, then successor' },
              { value: 'co_trustees', label: 'Co-trustees' },
            ]}
            onChange={v => onChange('trustee_structure', (v || null) as 'single' | 'spouse_first' | 'co_trustees' | null)}
          />
        </div>
        {sheet.trustee_structure === 'co_trustees' && (
          <div className="mt-4 max-w-[320px]">
            <FieldLabel>Co-Trustee Decision Standard</FieldLabel>
            <div className={cn('flex gap-0.5 rounded-lg bg-muted p-[2px]')}>
              {[
                { value: 'majority', label: 'Majority (3+)' },
                { value: 'unanimous', label: 'Unanimous' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange('cotrustee_decision_standard', opt.value as 'majority' | 'unanimous')}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
                    (sheet.cotrustee_decision_standard ?? 'majority') === opt.value
                      ? 'bg-card font-semibold text-primary shadow-sm'
                      : 'text-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </SectionBlock>

      {ROLES.map(role => {
        const slots = (sheet[SLOT_FIELDS[role]] as FiduciarySlot[]) ?? []

        const sameAsTrustee =
          role === 'executor' ? sheet.executor_same_as_trustee :
          role === 'poa' ? sheet.poa_same_as_trustee :
          undefined

        const onSameAsTrusteeToggle =
          role === 'executor' ? () => {
            const next = !sheet.executor_same_as_trustee
            onChange('executor_same_as_trustee', next)
            if (next) onChange('executor_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['executor_slots'])
          } :
          role === 'poa' ? () => {
            const next = !sheet.poa_same_as_trustee
            onChange('poa_same_as_trustee', next)
            if (next) onChange('poa_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['poa_slots'])
          } :
          undefined

        if (role === 'trustee') {
          return (
            <FiduciaryBlock
              key={role}
              {...blockProps}
              role="trustee"
              sectionTitle={`${clientFirst || 'Client'}'s Trustees`}
              clientShortcutContact={separateTrusts ? null : clientContact}
              clientShortcutLabel={separateTrusts ? undefined : `${clientFirst || 'Client'} as initial trustee`}
            />
          )
        }

        if (role === 'executor') {
          return (
            <FiduciaryBlock
              key={role}
              {...blockProps}
              role="executor"
              sameAsTrustee={sameAsTrustee}
              onSameAsTrusteeToggle={onSameAsTrusteeToggle}
              clientShortcutContact={clientContact}
              clientShortcutLabel="Client as primary personal representative"
              spouseOptionLabel="Spouse as personal representative"
            />
          )
        }

        if (role === 'poa') {
          return (
            <FiduciaryBlock
              key={role}
              {...blockProps}
              role="poa"
              sameAsTrustee={sameAsTrustee}
              onSameAsTrusteeToggle={onSameAsTrusteeToggle}
              spouseOptionLabel="Spouse as DPOA agent"
            />
          )
        }

        if (role === 'hcp') {
          return (
            <FiduciaryBlock
              key={role}
              {...blockProps}
              role="hcp"
              spouseOptionLabel="Spouse as health care agent"
            />
          )
        }

        return (
          <FiduciaryBlock
            key={role}
            {...blockProps}
            role={role}
            spouseOptionLabel={
              role === 'guardian'
                ? 'Spouse as guardian'
                : role === 'temporary_guardian'
                  ? 'Spouse as temporary guardian'
                  : undefined
            }
          />
        )
      })}

      {inclusions.trust && separateTrusts && (
        <FiduciaryBlock
          {...blockProps}
          role="trustee"
          slotField="spouse_trustee_slots"
          sectionTitle={`${spouseFirst || 'Spouse'}'s Trustees`}
          coShortcutContact={clientContact}
          coShortcutLabel={`${clientFirst || 'Client'} as initial co-trustee`}
        />
      )}

      {spouseDocs && inclusions.will && (
        <FiduciaryBlock
          {...blockProps}
          role="executor"
          slotField="spouse_executor_slots"
          sectionTitle="Spouse / Partner Personal Representative"
          sameAsTrustee={sheet.spouse_executor_same_as_trustee}
          sameAsTrusteeLabel="Same as Spouse's Trustees"
          onSameAsTrusteeToggle={() => {
            const next = !sheet.spouse_executor_same_as_trustee
            onChange('spouse_executor_same_as_trustee', next)
            if (next) onChange('spouse_executor_slots', cloneSlots(spouseTrusteeSource) as DesignSheet['spouse_executor_slots'])
          }}
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner personal representative"
        />
      )}

      {spouseDocs && inclusions.dpoa && (
        <FiduciaryBlock
          {...blockProps}
          role="poa"
          slotField="spouse_poa_slots"
          sectionTitle="Spouse / Partner Durable Power of Attorney"
          sameAsTrustee={sheet.spouse_poa_same_as_trustee}
          sameAsTrusteeLabel="Same as Spouse's Trustees"
          onSameAsTrusteeToggle={() => {
            const next = !sheet.spouse_poa_same_as_trustee
            onChange('spouse_poa_same_as_trustee', next)
            if (next) onChange('spouse_poa_slots', cloneSlots(spouseTrusteeSource) as DesignSheet['spouse_poa_slots'])
          }}
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner DPOA agent"
        />
      )}

      {spouseDocs && inclusions.healthcare && (
        <FiduciaryBlock
          {...blockProps}
          role="hcp"
          slotField="spouse_hcp_slots"
          sectionTitle="Spouse / Partner Health Care Proxy"
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner health care agent"
        />
      )}

      {!hasMinorChildren && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-700/40 dark:bg-blue-950/30">
          <span className="text-[11px] text-blue-700 dark:text-blue-300">
            Guardian section shown — minor children on file: {minorChildren.map((c: { name?: string }) => c.name).filter(Boolean).join(', ')}.
          </span>
        </div>
      )}
    </div>
  )
}
