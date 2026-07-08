'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import type { FiduciaryRole, FiduciarySlot, MatterContact } from '@/types/database'
import type { SlotState } from '@/types/planReview'
import { SectionBlock, SlotStateToggle } from './shared'
import ContactPicker, { type Contact } from './ContactPicker'
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

function contactById(contacts: MatterContact[], id: string | null, extraContacts: Contact[] = []): Contact | null {
  if (!id) return null
  const c = [...extraContacts, ...contacts].find(x => x.id === id)
  return c ? (c as Contact) : null
}

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
      {sameAsTrustee !== undefined && onSameAsTrusteeToggle && (
        <div className="mb-4 flex items-center gap-2">
          <Checkbox checked={sameAsTrustee} onCheckedChange={onSameAsTrusteeToggle} />
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
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onSlotsChange(removeAlternate(slots, group.principal.order))}
                    className="mt-8 rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive"
                    title="Remove alternate"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

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
                        className="mt-6 rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive"
                        title={`Remove ${config.coLabel.toLowerCase()}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {config.allowCo && group.coSlots.length < config.maxCo && (
                <div className="ml-8 mt-1.5 pl-4">
                  <button
                    type="button"
                    onClick={() => onSlotsChange(addCo(slots, group.principal.order))}
                    className="flex items-center gap-1 text-[11px] font-medium text-accent transition-colors hover:text-accent/80"
                  >
                    <Plus className="h-3 w-3" />
                    Add {config.coLabel}
                  </button>
                </div>
              )}

              {groupIdx < groups.length - 1 && (
                <div className="mt-4 border-t border-dashed border-border" />
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => onSlotsChange(addAlternate(slots))}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Alternate {config.title.split(' / ')[0]}
        </Button>
      </div>
    </SectionBlock>
  )
}
