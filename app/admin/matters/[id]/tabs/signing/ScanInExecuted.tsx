'use client'

import { useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { ApprovalInbox, type ApprovalProposal } from '@/app/admin/components/ApprovalInbox'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TONE_NOTICE } from '@/lib/ui/tone'

interface ScanInResultView {
  originalName: string
  document: { documentId: string; name: string } | null
  reading: { kind: string | null; signedOn: string | null; witnessCount: number; notarized: boolean; confidence: number }
  notes: string[]
  proposal: ApprovalProposal | null
  error: string | null
}

/**
 * Scan in the executed originals. Each scan is read and filed to the matter
 * at once; what it shows is proposed as the record of the execution and
 * confirmed here, card by card, because recording an execution is a claim
 * that a document is valid.
 */
export function ScanInExecuted({ matterId, onSaved }: { matterId: string; onSaved?: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [originalsLocation, setOriginalsLocation] = useState('')
  const [signedOn, setSignedOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ScanInResultView[]>([])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const files = fileInput.current?.files
    if (!files || files.length === 0) {
      setError('Attach at least one scan.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      for (const file of Array.from(files)) body.append('files', file)
      if (originalsLocation.trim()) body.set('originalsLocation', originalsLocation.trim())
      if (signedOn) body.set('signedOn', signedOn)
      const response = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/signing/scan-in`, { method: 'POST', body })
      const json = (await response.json().catch(() => ({}))) as { results?: ScanInResultView[]; error?: string }
      if (!response.ok || !json.results) throw new Error(json.error ?? `Could not scan in the originals (${response.status})`)
      setResults(current => [...json.results!, ...current])
      if (fileInput.current) fileInput.current.value = ''
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not scan in the originals')
    } finally {
      setBusy(false)
    }
  }

  const proposals = results.map(result => result.proposal).filter((proposal): proposal is ApprovalProposal => Boolean(proposal))

  return (
    <Card data-testid="scan-in-executed">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScanLine className="size-4" aria-hidden />
          Scan in the executed originals
        </CardTitle>
        <CardDescription className="text-xs">
          Each scan is read and filed to the matter. What it shows is proposed as the record of the signing for you to confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="scan-files">Scans (PDF, JPEG or PNG)</Label>
            <Input id="scan-files" ref={fileInput} type="file" multiple accept="application/pdf,image/jpeg,image/png" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scan-originals">Originals kept at</Label>
            <Input id="scan-originals" value={originalsLocation} onChange={event => setOriginalsLocation(event.target.value)} placeholder="Firm vault, client, bank box…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scan-signed-on">Signed on (if the scan is hard to read)</Label>
            <Input id="scan-signed-on" type="date" value={signedOn} onChange={event => setSignedOn(event.target.value)} />
          </div>
          {error ? <p role="alert" className={`sm:col-span-2 ${TONE_NOTICE.danger}`}>{error}</p> : null}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Reading the scans…' : 'Scan in'}</Button>
          </div>
        </form>

        {results.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm" data-testid="scan-in-results">
            {results.map(result => (
              <li key={`${result.originalName}-${result.document?.documentId ?? 'unfiled'}`} className="space-y-1 px-4 py-3">
                <p className="font-medium">{result.document?.name ?? result.originalName}</p>
                {result.error ? <p className={TONE_NOTICE.danger}>{result.error}</p> : null}
                {result.notes.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {result.notes.map(note => <li key={note}>{note}</li>)}
                  </ul>
                )}
                {!result.proposal && !result.error && (
                  <p className="text-xs text-muted-foreground">Filed. The kind could not be read, so record it by hand below.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {proposals.length > 0 && (
          <ApprovalInbox
            key={proposals.map(proposal => proposal.id).join('|')}
            initialProposals={proposals}
            emptyMessage="Every scanned document has been recorded."
            onResolved={onSaved}
          />
        )}
      </CardContent>
    </Card>
  )
}
