'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookUser, Mail, Merge, Phone, Plus, Users } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { SearchField } from '@/components/SearchField'
import { FilterChip } from '@/components/FilterChip'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { openExternalPhone } from '@/lib/clientPhone'
import { phoneTelHref } from '@/lib/phone'
import { practiceAreaLabel } from '@/lib/practiceArea'
import {
  CONTACT_KIND_LABELS,
  EMPTY_CONTACT_TABLE_FILTERS,
  countContactsByKind,
  filterAndSortContacts,
  type ContactDirectoryRow,
  type ContactKind,
  type ContactKindFilter,
  type ContactSortKey,
} from '@/lib/adminTables/contactTable'
import { AddContactDialog } from './AddContactDialog'
import { ContactSidePanel } from './ContactSidePanel'

const KIND_FILTERS: { value: ContactKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'lead', label: 'Leads' },
  { value: 'client', label: 'Clients' },
  { value: 'other', label: 'Others' },
  { value: 'lost', label: 'Lost leads' },
]

const KIND_BADGE_CLASSES: Record<ContactKind, string> = {
  lead: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  client: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  lost: 'bg-muted text-muted-foreground',
  other: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
}

function KindBadge({ kind }: { kind: ContactKind }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        KIND_BADGE_CLASSES[kind],
      )}
    >
      {CONTACT_KIND_LABELS[kind]}
    </span>
  )
}

interface ContactsClientProps {
  contacts: ContactDirectoryRow[]
  smsEnabled: boolean
  title?: string
  eyebrow?: string
  description?: string
}

export function ContactsClient({
  contacts,
  smsEnabled,
  title = 'Contacts',
  eyebrow = 'Directory',
  description = 'Everyone the firm knows — leads, clients, and the people connected to them.',
}: ContactsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState(EMPTY_CONTACT_TABLE_FILTERS)
  const [sortKey, setSortKey] = useState<ContactSortKey>('name_asc')
  const [addOpen, setAddOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Deep link from the softphone: /admin/crm/people?selected=contact:<uuid>.
  // A bare uuid works too, so the caller doesn't have to know the namespace.
  const requestedId = searchParams?.get('selected') ?? null
  useEffect(() => {
    if (!requestedId) return
    const match = contacts.find(contact =>
      contact.id === requestedId || contact.id === `contact:${requestedId}`,
    )
    if (match) setSelectedId(match.id)
  }, [requestedId, contacts])

  const counts = useMemo(() => countContactsByKind(contacts), [contacts])
  const visible = useMemo(
    () => filterAndSortContacts(contacts, filters, sortKey),
    [contacts, filters, sortKey],
  )
  const selected = useMemo(
    () => contacts.find(contact => contact.id === selectedId) ?? null,
    [contacts, selectedId],
  )
  const relatedOptions = useMemo(
    () => contacts
      .filter(contact => contact.kind !== 'other')
      .map(contact => ({ id: contact.id.replace('intake:', ''), name: contact.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        eyebrow={eyebrow}
        icon={BookUser}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild type="button" size="sm" variant="outline">
              <Link href="/admin/contacts/merge">
                <Merge className="h-3.5 w-3.5" />
                Duplicates
              </Link>
            </Button>
            <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add contact
            </Button>
          </div>
        }
      />

      <section aria-label="Directory controls" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={filters.search}
          onValueChange={search => setFilters(prev => ({ ...prev, search }))}
          placeholder="Search name, email, phone, matter…"
          aria-label="Search contacts"
          containerClassName="w-full sm:w-72"
        />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Contact types">
          {KIND_FILTERS.map(option => (
            <FilterChip
              key={option.value}
              selected={filters.kind === option.value}
              count={counts[option.value]}
              onClick={() => setFilters(prev => ({ ...prev, kind: option.value }))}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
        <div className="ml-auto">
          <Select value={sortKey} onValueChange={value => setSortKey(value as ContactSortKey)}>
            <SelectTrigger size="sm" aria-label="Sort contacts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="name_asc">Name A–Z</SelectItem>
              <SelectItem value="name_desc">Name Z–A</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p role="status" className="text-xs text-muted-foreground">{visible.length} of {contacts.length} people · Select Details to review a person.</p>
        {(filters.search || filters.kind !== 'all') && <Button type="button" size="sm" variant="ghost" onClick={() => setFilters(EMPTY_CONTACT_TABLE_FILTERS)}>Clear filters</Button>}
      </div>
      </section>

      <div className="flex flex-col items-stretch gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {visible.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts match"
              description={
                contacts.length === 0
                  ? 'Contacts appear here as leads come in and matters are opened.'
                  : 'Try a different search or filter.'
              }
              action={
                contacts.length === 0 ? (
                  <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add contact
                  </Button>
                ) : <Button type="button" size="sm" variant="outline" onClick={() => setFilters(EMPTY_CONTACT_TABLE_FILTERS)}>Clear filters</Button>
              }
            />
          ) : (
            <div className="rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className={cn('md:table-cell', selected ? 'hidden xl:table-cell' : 'hidden')}>Location</TableHead>
                    <TableHead className={cn(selected ? 'hidden' : 'hidden lg:table-cell')}>Practice</TableHead>
                    <TableHead className="w-[76px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(contact => {
                    const location = [contact.city, contact.state].filter(Boolean).join(', ')
                    const tel = phoneTelHref(contact.phone)
                    return (
                      <TableRow
                        key={contact.id}
                        data-state={selected?.id === contact.id ? 'selected' : undefined}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(current => (current === contact.id ? null : contact.id))}
                      >
                        <TableCell className="whitespace-normal break-words">
                          {contact.href ? (
                            <Link
                              href={contact.href}
                              className="font-medium hover:underline"
                              onClick={event => event.stopPropagation()}
                            >
                              {contact.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{contact.name}</span>
                          )}
                          <div className="mt-1 sm:hidden"><KindBadge kind={contact.kind} /></div>
                          <div className="mt-1 space-y-1 text-xs text-muted-foreground md:hidden">
                            {contact.email && <a href={`mailto:${contact.email}`} className="block break-all hover:underline" onClick={event => event.stopPropagation()}>{contact.email}</a>}
                            {contact.phone && (tel ? <a href={tel} className="block hover:underline" onClick={event => event.stopPropagation()}>{contact.phone}</a> : <span className="block">{contact.phone}</span>)}
                          </div>
                          {(contact.relationship || contact.matter_number) && (
                            <div className="text-xs text-muted-foreground">
                              {contact.relationship ?? contact.matter_number}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <KindBadge kind={contact.kind} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {contact.email ? (
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-muted-foreground hover:text-foreground hover:underline"
                              onClick={event => event.stopPropagation()}
                            >
                              {contact.email}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap md:table-cell">
                          {contact.phone ? (
                            tel ? (
                              <a
                                href={tel}
                                className="text-muted-foreground hover:text-foreground hover:underline"
                                onClick={event => event.stopPropagation()}
                              >
                                {contact.phone}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">{contact.phone}</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className={cn('text-muted-foreground md:table-cell', selected ? 'hidden xl:table-cell' : 'hidden')}>
                          {location || '—'}
                        </TableCell>
                        <TableCell className={cn('text-muted-foreground', selected ? 'hidden' : 'hidden lg:table-cell')}>
                          {contact.practice_area ? practiceAreaLabel(contact.practice_area) : '—'}
                        </TableCell>
                        {/* Reach anyone without opening the panel first. Email
                            opens the panel, which hosts the composer. */}
                        <TableCell className="text-right whitespace-nowrap">
                          <Button type="button" size="sm" variant="ghost" aria-label={`View details for ${contact.name}`} aria-expanded={selected?.id === contact.id} aria-controls={selected?.id === contact.id ? 'contact-details-panel' : undefined} onClick={event => { event.stopPropagation(); setSelectedId(current => current === contact.id ? null : contact.id) }}>Details</Button>
                          {contact.phone && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="hidden h-7 w-7 p-0 sm:inline-flex"
                              aria-label={`Call ${contact.name}`}
                              onClick={event => {
                                event.stopPropagation()
                                openExternalPhone({ number: contact.phone ?? undefined })
                              }}
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {contact.email && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="hidden h-7 w-7 p-0 sm:inline-flex"
                              aria-label={`Email ${contact.name}`}
                              onClick={event => {
                                event.stopPropagation()
                                setSelectedId(contact.id)
                              }}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

        </div>

        {selected && (
          <ContactSidePanel
            contact={selected}
            smsEnabled={smsEnabled}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      <AddContactDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        relatedOptions={relatedOptions}
        onCreated={() => router.refresh()}
      />
    </div>
  )
}
