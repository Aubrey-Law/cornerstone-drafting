'use client'

import { MoreHorizontal, Pencil, Trash2, User, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatDobWithAge } from '@/lib/dob'
import { formatPhoneDisplay } from '@/lib/phone'
import type { MatterContact } from '@/types/database'
import type { ContactProfile } from '@/lib/designSheet/fiduciaryDocumentInclusions'

function contactName(c: MatterContact): string {
  return [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ').trim() || '—'
}

function relationshipLine(contact: MatterContact, profile?: ContactProfile, roleLabel?: string): string | null {
  if (roleLabel) return roleLabel
  if (profile?.relationship_detail?.trim()) {
    const base = profile.relationship_to === 'client'
      ? 'client'
      : profile.relationship_to === 'spouse'
        ? 'spouse'
        : profile.relationship_to === 'joint'
          ? 'client and spouse'
          : null
    if (base) return `(${profile.relationship_detail.trim()} — ${base})`
    return `(${profile.relationship_detail.trim()})`
  }
  if (contact.relationship?.trim()) return `(${contact.relationship.trim()})`
  return null
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
  const rel = relationshipLine(contact, profile, roleLabel)
  const address = contact.address?.trim() || null
  const phone = formatPhoneDisplay(contact.phone) || null
  const email = contact.email?.trim() || null
  const age = contact.date_of_birth ? formatDobWithAge(contact.date_of_birth) : null

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <User className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-primary">{name}</p>
              {showAlsoAsBeneficiary && (
                <span title="Also a beneficiary" className="text-primary">
                  <UserPlus className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            {rel && <p className="text-xs text-muted-foreground">{rel}</p>}
          </div>
        </div>
        {(onEdit || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
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
      </div>
      <dl className="space-y-1 text-xs">
        {typeLabel && (
          <div className="flex gap-2">
            <dt className="font-semibold text-foreground">Type:</dt>
            <dd className="text-muted-foreground">{typeLabel}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-foreground">Address:</dt>
          <dd className={cn(!address && 'italic text-muted-foreground')}>
            {address || 'No Address provided'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-foreground">Phone:</dt>
          <dd className={cn(!phone && 'italic text-muted-foreground')}>
            {phone || 'No Phone provided'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-foreground">Email:</dt>
          <dd className={cn(!email && 'italic text-muted-foreground')}>
            {email || 'No Email provided'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-foreground">Age:</dt>
          <dd className={cn(!age && 'italic text-muted-foreground')}>
            {age || 'No DOB provided'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function PersonContactCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}
