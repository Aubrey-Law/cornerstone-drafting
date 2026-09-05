'use client'

import { useMemo, useState } from 'react'
import { Checkbox } from '@aubrey-law/ui/checkbox'
import { Label } from '@aubrey-law/ui/label'
import {
  DOCUMENT_KINDS,
  ceremonyPlan,
  documentLabel,
  type DocumentKind,
  type NotaryRequirement,
} from '@/lib/execution/requirements'

const NOTARY_TEXT: Record<NotaryRequirement, string> = {
  required: 'Notary required',
  required_in_practice: 'Notarised in practice',
  recommended: 'Notary recommended',
  not_required: 'No notary needed',
}

export function ExecutionChecklist({
  detected,
  unmatched,
}: {
  detected: DocumentKind[]
  unmatched: string[]
}) {
  const [selected, setSelected] = useState<DocumentKind[]>(detected)
  const plan = useMemo(() => ceremonyPlan(selected), [selected])

  const toggle = (kind: DocumentKind) =>
    setSelected((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    )

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">What is being signed</h2>
          <p className="text-xs text-muted-foreground">
            Taken from the document names, which record no document type — so this is a reading of
            the file names, not a fact. Correct it before you rely on the checklist.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {DOCUMENT_KINDS.map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <Checkbox
                id={`kind-${kind}`}
                checked={selected.includes(kind)}
                onCheckedChange={() => toggle(kind)}
              />
              <Label htmlFor={`kind-${kind}`} className="font-normal">
                {documentLabel(kind)}
              </Label>
            </div>
          ))}
        </div>
        {unmatched.length > 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {unmatched.length} document{unmatched.length === 1 ? '' : 's'} not recognised:
            </span>{' '}
            {unmatched.join(', ')}. Tick anything above that needs signing.
          </p>
        ) : null}
      </section>

      <section className="space-y-3" data-testid="ceremony">
        <h2 className="text-sm font-semibold">The appointment</h2>
        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">Choose what is being signed.</p>
        ) : (
          <dl className="grid gap-3 rounded-md border border-border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Witnesses to bring</dt>
              {/* The maximum any one document needs — the same people sit through all of it. */}
              <dd className="font-medium">{plan.witnessesNeeded}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notary</dt>
              <dd className="font-medium">{plan.notaryRequired ? 'Must attend' : 'Not needed'}</dd>
            </div>
            {plan.disqualifiedWitnesses.length > 0 ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Who may not witness</dt>
                <dd className="font-medium">{plan.disqualifiedWitnesses.join('; ')}</dd>
              </div>
            ) : null}
            {plan.recordings.length > 0 ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">To record afterwards</dt>
                <dd>
                  <ul className="list-disc space-y-0.5 pl-4 font-medium">
                    {plan.recordings.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </section>

      {plan.documents.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Document by document</h2>
          <ul className="divide-y divide-border border-y border-border">
            {plan.documents.map((doc) => (
              <li key={doc.kind} data-testid={`requirement-${doc.kind}`} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{documentLabel(doc.kind)}</span>
                  <span className="text-sm text-muted-foreground">
                    {doc.witnesses === 0
                      ? 'No witnesses'
                      : `${doc.witnesses} witness${doc.witnesses === 1 ? '' : 'es'}`}{' '}
                    · {NOTARY_TEXT[doc.notary]}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">Signed by {doc.signers.join(', ')}.</p>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {doc.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                {/* Cited so it can be checked against the statute rather than believed. */}
                <p className="font-mono text-xs text-muted-foreground">{doc.citation}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
