'use client'

import { MoreHorizontal, Pencil, Trash2, User } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ageInYearsFromDob, formatDateOnly } from '@/lib/dob'
import { CallPhoneLink } from '@/components/phone/CallPhoneLink'
import type { MatterContact } from '@/types/database'
import type { ContactProfile } from '@/lib/designSheet/fiduciaryDocumentInclusions'
import { formatContactRelationshipLine } from '@/lib/kinship/relationshipLabels'

function contactName(contact: MatterContact): string {
  return [contact.first_name, contact.middle_name, contact.last_name].filter(Boolean).join(' ').trim() || '—'
}

function relationshipLine(contact: MatterContact, profile?: ContactProfile, roleLabel?: string): string | null {
  if (roleLabel) return roleLabel.replace(/^\(|\)$/g, '')
  return formatContactRelationshipLine(profile, contact, 'client')
}

export interface PersonContactCardProps {
  contact: MatterContact
  profile?: ContactProfile
  typeLabel?: string
  roleLabel?: string
  showAlsoAsBeneficiary?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

export function PersonContactCard({
  contact,
  profile,
  typeLabel,
  roleLabel,
  showAlsoAsBeneficiary,
  onEdit,
  onDelete,
}: PersonContactCardProps) {
  const name = contactName(contact)
  const roles = [
    relationshipLine(contact, profile, roleLabel),
    typeLabel,
    showAlsoAsBeneficiary ? 'Beneficiary' : null,
  ].filter((value): value is string => Boolean(value))
  const details = [
    contact.address?.trim() || null,
    contact.email?.trim() || null,
  ].filter((value): value is string => Boolean(value))
  const age = ageInYearsFromDob(contact.date_of_birth)
  const dob = contact.date_of_birth
    ? `Date of birth · ${formatDateOnly(contact.date_of_birth)}${age === null ? '' : ` · age ${age}`}`
    : null

  return (
    <article className="group flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <User className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{name}</p>
          {roles.map(role => (
            <span key={role} className="rounded-full bg-muted px-2 py-0.5 text-micro font-medium text-muted-foreground">
              {role}
            </span>
          ))}
        </div>
        {(details.length > 0 || contact.phone || dob) && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {details.map(detail => <span key={detail}>{detail}</span>)}
            <CallPhoneLink phone={contact.phone} />
            {dob && <span>{dob}</span>}
          </div>
        )}
      </div>
      {(onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${name}`}
              className="rounded p-1 text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </article>
  )
}

export function PersonContactCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-card">{children}</div>
}
