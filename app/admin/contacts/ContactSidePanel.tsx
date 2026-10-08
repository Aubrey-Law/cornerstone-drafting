'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, FilePlus, Mail, Phone, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RecordCommunicationsCard } from '@/components/comms/RecordCommunicationsCard'
import { CommunicationDialog, type CommunicationTarget } from '@/components/comms/CommunicationDialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { openExternalPhone } from '@/lib/clientPhone'
import { ContactCard } from '@/components/contacts/ContactCard'
import {
  CONTACT_KIND_LABELS,
  contactRowId,
  intakeRowId,
  type ContactDirectoryRow,
} from '@/lib/adminTables/contactTable'
import { describeDeletionProtections } from '@/lib/matters/deletionProtections'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ContactSidePanelProps {
  contact: ContactDirectoryRow
  smsEnabled: boolean
  onClose: () => void
}

export function ContactSidePanel({ contact, smsEnabled, onClose }: ContactSidePanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    panelRef.current?.focus()
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus() }
  }, [contact.id])
  const router = useRouter()
  const token = useAccessToken()
  const [composerChannel, setComposerChannel] = useState<'email' | 'sms' | null>(null)
  const [openingMatter, setOpeningMatter] = useState(false)
  const [openMatterError, setOpenMatterError] = useState<string | null>(null)
  const openMatterRequestId = useRef<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  /**
   * What the server said would be destroyed with this person, once it has been
   * asked. Empty until then: the dialog only names client work it has actually
   * been told about, and the second click acknowledges it.
   */
  const [deleteProtections, setDeleteProtections] = useState<string[]>([])

  /**
   * Remove this person from the directory for good.
   *
   * The People list has no archive, so this is its only exit — a duplicate, a
   * misspelled entry, somebody added in error. A person whose engagements hold
   * client work comes back untouched with the reasons named; the next click
   * carries the acknowledgement.
   */
  async function deletePerson() {
    if (!token) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/admin/people/${encodeURIComponent(contact.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteProtections.length > 0 }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        requiresConfirmation?: boolean
        protections?: string[]
      }
      if (json.requiresConfirmation) {
        setDeleteProtections(json.protections?.length ? json.protections : ['hired'])
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Could not delete this person')
      setDeleteOpen(false)
      setDeleteProtections([])
      onClose()
      router.refresh()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete this person')
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Open a matter for this person, reusing the `contacts` row the firm already
   * has rather than minting a duplicate — a returning client, or a child
   * getting their own College Prep plan.
   */
  async function openMatter() {
    if (!contact.self_contact_id || !token) return
    setOpenMatterError(null)
    // Held across retries so a double-click resolves to one matter, and cleared
    // on success so opening a genuine second one still works.
    if (!openMatterRequestId.current) {
      openMatterRequestId.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null
    }
    setOpeningMatter(true)
    try {
      const res = await fetch('/api/admin/matters/open-for-person', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.self_contact_id,
          planType: contact.practice_area,
          requestId: openMatterRequestId.current,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not open the matter')
      openMatterRequestId.current = null
      router.push(`/admin/matters/${json.matterId}`)
    } catch (error) {
      setOpenMatterError(error instanceof Error ? error.message : 'Could not open the matter')
    } finally {
      setOpeningMatter(false)
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const contactId = contactRowId(contact.id)
  const intakeId = intakeRowId(contact.id)

  // A contacts-table row threads through itself, not through the household it
  // hangs off — otherwise a trustee's panel shows the client's whole message
  // history under the trustee's name. Intake rows keep their lead/matter thread.
  const reachable = Boolean(contact.phone || contact.email)
  const record = !reachable
    ? null
    : contactId
      ? { type: 'contact' as const, id: contactId }
      : contact.thread
  const smsRole = contact.relationship_type === 'spouse' ? 'spouse' as const : 'client' as const

  // The composer targets the same record the thread does, so a reply lands in
  // the timeline shown right below it.
  const composerTarget: CommunicationTarget | null = contactId
    ? { type: 'contact', id: contactId }
    : contact.thread
      ? contact.thread.type === 'matter'
        ? { type: 'matter', id: contact.thread.id, recipient: smsRole }
        : { type: 'lead', id: contact.thread.id }
      : null

  return (
    <aside
      id="contact-details-panel"
      ref={panelRef}
      tabIndex={-1}
      aria-label={`${contact.name} contact details`}
      className="order-first flex max-h-[calc(100dvh-6rem)] w-full shrink-0 flex-col rounded-xl border border-border bg-card shadow xl:sticky xl:top-4 xl:order-last xl:h-[calc(100dvh-6rem)] xl:w-[440px]"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-muted text-micro font-semibold text-muted-foreground"
        >
          {contact.name.trim().charAt(0).toUpperCase() || '—'}
        </span>
        <span className="truncate text-sm font-semibold">{contact.name}</span>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-micro font-medium text-muted-foreground">
          {CONTACT_KIND_LABELS[contact.kind]}
        </span>
        {contact.href && (
          <Button asChild type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2">
            <Link href={contact.href} aria-label="Open full record">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={contact.href ? 'h-7 px-2' : 'ml-auto h-7 px-2'}
          aria-label="Close contact panel"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {composerTarget && (contact.email || contact.phone) && (
          <div className="flex flex-wrap items-center gap-2">
            {contact.phone && (
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => openExternalPhone({ number: contact.phone ?? undefined })}
              >
                <Phone className="h-3.5 w-3.5" />
                Call
              </Button>
            )}
            <Button
              type="button" size="sm" variant="outline"
              disabled={!contact.email}
              onClick={() => setComposerChannel('email')}
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </Button>

          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {contact.self_contact_id && (
            <Button
              type="button" size="sm" variant="outline"
              disabled={openingMatter}
              onClick={openMatter}
              title="Open a new matter for this person, reusing their record and household"
            >
              <FilePlus className="h-3.5 w-3.5" />
              {openingMatter ? 'Opening…' : 'New matter'}
            </Button>
          )}
          <Button
            type="button" size="sm" variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => { setDeleteProtections([]); setDeleteError(null); setDeleteOpen(true) }}
            title="Remove this person from the directory for good"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
        {openMatterError && (
          <p role="alert" className="text-sm text-destructive">{openMatterError}</p>
        )}

        <ContactCard contact={contact} />

        {record ? (
          <section>
            {/* The card carries its own Call button alongside the channel chips. */}
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Activity & communications
            </h3>
            <RecordCommunicationsCard
              key={contact.id}
              record={record}
              recipientName={contact.name}
              recipientEmail={contact.email}
              recipientPhone={contact.phone}
              smsEnabled={smsEnabled}
              smsRecipientRole={smsRole}
              smsSendable={Boolean(contact.phone)}
              smsDisabledReason="No phone number on file, so there's nothing to text."
            />
          </section>
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No phone or email on file, so there&apos;s no way to reach this contact yet.
          </p>
        )}
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={open => { if (!open) { setDeleteOpen(false); setDeleteProtections([]); setDeleteError(null) } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {contact.name}?</DialogTitle>
            <DialogDescription>
              {intakeId
                ? 'This destroys their record and every matter opened for them — intake answers, documents, notes, activity and messages. It cannot be undone.'
                : 'This removes them from the firm directory for good, along with the roles they hold on any matter. Emails, texts and calls already logged are kept. It cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          {deleteProtections.length > 0 && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              This person holds client work — {describeDeletionProtections(deleteProtections).join(', and ')}.
              Nothing has been deleted yet. Confirm to go through with it.
            </p>
          )}
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              type="button" variant="outline" disabled={deleting}
              onClick={() => { setDeleteOpen(false); setDeleteProtections([]); setDeleteError(null) }}
            >
              Cancel
            </Button>
            <Button
              type="button" variant="destructive" disabled={deleting}
              onClick={() => void deletePerson()}
            >
              {deleting
                ? 'Deleting…'
                : deleteProtections.length > 0
                  ? 'Delete anyway'
                  : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {composerTarget && (
        <CommunicationDialog
          open={composerChannel !== null}
          channel={composerChannel ?? 'email'}
          target={composerTarget}
          recipientName={contact.name}
          recipientEmail={contact.email}
          recipientPhone={contact.phone}
          token={token}
          onOpenChange={open => { if (!open) setComposerChannel(null) }}
          onSent={() => router.refresh()}
        />
      )}
    </aside>
  )
}
