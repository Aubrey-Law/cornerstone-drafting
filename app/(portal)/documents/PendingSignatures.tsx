import Link from 'next/link'
import { Clock, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  portalSigningHref,
  signatureStatusLine,
  signatureTitle,
  summarisePendingSignatures,
  type PortalSignature,
} from '@/lib/portal/signatures'

/**
 * What is waiting for a signature on this matter: the client's own items with a
 * "Review and sign" button, then anyone else's (a spouse, usually) as a line
 * saying who it waits on. Server-rendered; the signing itself happens on the
 * item's own page.
 */
export default function PendingSignatures({ signatures, matterClosed }: { signatures: PortalSignature[]; matterClosed: boolean }) {
  if (signatures.length === 0) return null
  const { mine, others } = summarisePendingSignatures(signatures)

  return (
    <section id="sign" className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">Ready for your signature</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {mine.length === 0
          ? 'Nothing is waiting on you right now.'
          : mine.length === 1
            ? 'One document is waiting for your signature. You can read it in full before you sign.'
            : `${mine.length} documents are waiting for your signature. You can read each one in full before you sign.`}
      </p>
      <ul className="mt-4 divide-y divide-border/60">
        {[...mine, ...others].map(signature => (
          <li key={signature.sessionId} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{signatureTitle(signature)}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {signature.mine
                  ? <PenLine className="size-3.5" aria-hidden />
                  : <Clock className="size-3.5" aria-hidden />}
                {signatureStatusLine(signature)}
              </p>
            </div>
            {signature.mine && !matterClosed && (
              <Button asChild size="sm" className="gap-1.5">
                <Link href={portalSigningHref(signature.sessionId)}>
                  <PenLine className="size-3.5" aria-hidden /> Review and sign
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
