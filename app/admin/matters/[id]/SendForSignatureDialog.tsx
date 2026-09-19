'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { sendDocumentForSignature } from '@/lib/documents'
import { CEREMONY_ATTESTATION_TEXT, MAX_SIGNERS } from '@/lib/esign/ceremony'
import { isRequestLive } from '@/lib/esign/requestStatus'
import type { SignatureRequestSummary } from '@/lib/esign/requestStatus'
import { formatDateTime } from '@/lib/utils'
import type { MatterDocument } from '@/types/database'

/**
 * Send a PDF already filed to this matter out for signature.
 *
 * Everything behind this — the appended signature page, the anchors, the seal,
 * the audit certificate — has existed since #546 with no way to reach it. This
 * is that way.
 *
 * Two of its jobs are refusals rather than fields. The attestation is the
 * G.L. c. 190B gate and the Send button stays disabled until it is ticked: the
 * route refuses without it, but an attorney should not have to learn that from
 * an error. And the send has no server-side dedupe, so a document already out
 * for signature says so before a second set of links goes to the same inbox.
 */

interface SignerDraft {
  name: string
  email: string
  role: string
}

const EXPIRY_CHOICES = [
  { value: '168', label: '7 days' },
  { value: '336', label: '14 days' },
  { value: '720', label: '30 days' },
]

export function SendForSignatureDialog({
  matterId,
  document,
  defaultSigner = null,
  existingRequest = null,
  onOpenChange,
  onSent,
}: {
  matterId: string
  /** The document being sent; null closes the dialog. */
  document: MatterDocument | null
  defaultSigner?: { name: string; email: string } | null
  /** The most recent request for this document, if there is one. */
  existingRequest?: SignatureRequestSummary | null
  onOpenChange: (open: boolean) => void
  onSent: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [signers, setSigners] = useState<SignerDraft[]>([{ name: '', email: '', role: '' }])
  const [message, setMessage] = useState('')
  const [expirationHours, setExpirationHours] = useState('168')
  const [attested, setAttested] = useState(false)
  const [sending, setSending] = useState(false)
  /**
   * The disabled button is what a person runs into; this is what a double
   * dispatch in one tick runs into. `sending` is state, so a second handler
   * called before React re-renders still reads false — and the server has no
   * dedupe, so that second send is a second request with its own live links.
   */
  const inFlight = useRef(false)

  useEffect(() => {
    if (!document) return
    // The same fallback the route applies, so what is shown is what would be
    // used if the field were left alone.
    setName(document.name.replace(/\.pdf$/i, ''))
    setSigners([{
      name: defaultSigner?.name ?? '',
      email: defaultSigner?.email ?? '',
      role: '',
    }])
    setMessage('')
    setExpirationHours('168')
    // Never carried over from a previous send. It is a fresh judgement about a
    // different document every time.
    setAttested(false)
  }, [document, defaultSigner])

  const updateSigner = (index: number, patch: Partial<SignerDraft>) => {
    setSigners(previous => previous.map((signer, position) => (
      position === index ? { ...signer, ...patch } : signer
    )))
  }

  const submit = async () => {
    if (!document || inFlight.current) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Give the document a name the signer will recognise')
      return
    }
    const filled = signers
      .map(signer => ({
        name: signer.name.trim(),
        email: signer.email.trim(),
        role: signer.role.trim(),
      }))
      .filter(signer => signer.name || signer.email)
    if (filled.length === 0) {
      toast.error('Add at least one signer, with a name and an email')
      return
    }
    if (filled.some(signer => !signer.name || !signer.email.includes('@'))) {
      toast.error('Every signer needs a name and an email address')
      return
    }
    const addresses = filled.map(signer => signer.email.toLowerCase())
    if (new Set(addresses).size !== addresses.length) {
      // The service refuses this too. Catching it here says so before a 60
      // second round trip that ends in an error.
      toast.error('Each signer needs their own email address')
      return
    }

    inFlight.current = true
    setSending(true)
    try {
      await sendDocumentForSignature(matterId, {
        documentId: document.id,
        name: trimmedName,
        signers: filled.map(signer => ({
          name: signer.name,
          email: signer.email,
          ...(signer.role ? { role: signer.role } : {}),
        })),
        message: message.trim(),
        expirationHours: Number(expirationHours),
        ceremonyAttested: attested,
      })
      toast.success(filled.length === 1
        ? `Sent to ${filled[0].email}`
        : `Sent to ${filled.length} signers`)
      onOpenChange(false)
      await onSent()
    } catch (error) {
      // The route's refusals name a cause an attorney can act on — a document
      // that already carries markers, a duplicate address, too many signers.
      // They are shown as written rather than replaced with a generic line.
      toast.error(error instanceof Error ? error.message : 'Could not send this document for signature')
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return (
    <Dialog
      open={document !== null}
      // Closing mid-send would leave the attorney with no idea whether the
      // emails went out; the work is inline and can take most of a minute.
      onOpenChange={open => { if (!open && !sending) onOpenChange(false) }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send for signature</DialogTitle>
          <DialogDescription>
            {document?.name ?? ''} — a signature page is added to the end, and each signer gets
            their own link. The signed copy comes back into this matter&rsquo;s documents.
          </DialogDescription>
        </DialogHeader>

        {isRequestLive(existingRequest) && (
          <div
            role="alert"
            className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber"
          >
            This document is already out for signature
            {existingRequest?.sentAt ? `, sent ${formatDateTime(existingRequest.sentAt)}` : ''}
            {' '}to {existingRequest?.signers.map(signer => signer.email).join(', ')}.
            Sending again creates a second request and a second set of links, both live. To
            replace it rather than duplicate it, close this and withdraw the first from the
            document&rsquo;s menu.
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signature-request-name">Document name</Label>
            <Input
              id="signature-request-name"
              value={name}
              onChange={event => setName(event.target.value)}
            />
            <p className="text-micro text-muted-foreground">
              Shown to the signer and used as the subject of the email.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Signers</Label>
            {signers.map((signer, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_7rem]">
                  <Input
                    value={signer.name}
                    placeholder="Full name"
                    aria-label={`Signer ${index + 1} name`}
                    onChange={event => updateSigner(index, { name: event.target.value })}
                  />
                  <Input
                    type="email"
                    value={signer.email}
                    placeholder="name@example.com"
                    aria-label={`Signer ${index + 1} email`}
                    onChange={event => updateSigner(index, { email: event.target.value })}
                  />
                  <Input
                    value={signer.role}
                    placeholder="Role"
                    aria-label={`Signer ${index + 1} role`}
                    onChange={event => updateSigner(index, { role: event.target.value })}
                  />
                </div>
                {signers.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0"
                    aria-label={`Remove signer ${index + 1}`}
                    onClick={() => setSigners(previous => previous.filter((_, position) => position !== index))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={signers.length >= MAX_SIGNERS}
              onClick={() => setSigners(previous => [...previous, { name: '', email: '', role: '' }])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add signer
            </Button>
            <p className="text-micro text-muted-foreground">
              Signature lines are added in this order, on a page appended to the end. Role is
              optional and is printed above the line. At most {MAX_SIGNERS} signers fit on the page.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signature-request-message">Message</Label>
            <Textarea
              id="signature-request-message"
              rows={3}
              value={message}
              placeholder="Optional. Appears in the email above the signing link."
              onChange={event => setMessage(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signature-request-expiry">Links expire after</Label>
            <Select value={expirationHours} onValueChange={setExpirationHours}>
              <SelectTrigger id="signature-request-expiry" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_CHOICES.map(choice => (
                  <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The G.L. c. 190B gate. The wording is imported rather than written
              here: it is stored verbatim on the request, and a copy would let
              what is shown drift from what is recorded. */}
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-3">
            <Checkbox
              id="signature-request-attestation"
              checked={attested}
              onCheckedChange={checked => setAttested(checked === true)}
            />
            <Label
              htmlFor="signature-request-attestation"
              className="text-xs font-normal leading-relaxed"
            >
              {CEREMONY_ATTESTATION_TEXT}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={sending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" className="gap-1.5" disabled={!attested || sending} onClick={() => void submit()}>
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {sending ? 'Sending…' : 'Send for signature'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
