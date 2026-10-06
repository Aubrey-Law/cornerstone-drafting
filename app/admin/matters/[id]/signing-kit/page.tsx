import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requireStaffPage } from '@/lib/review/staff'
import { isUuid } from '@/lib/queries/tasks'
import { loadSigningKit } from '@/lib/signing/loadKit'
import { PrintKitButton } from './PrintKitButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Signing-day kit' }

/**
 * The printable signing-day kit for one matter: who must be in the room, the
 * signing order with its tabs, what the witnesses and the notary are told,
 * and what happens after the pens go down. Laid out for US Letter; the
 * screen chrome hides when printed.
 */
export default async function SigningKitPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const loaded = await loadSigningKit(id)
  if (!loaded) notFound()
  const { kit } = loaded

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-4 print:text-xs" data-testid="signing-kit">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/matters/${encodeURIComponent(id)}?tab=documents&view=signing`}>
            <ArrowLeft className="size-4" aria-hidden />
            Signing view
          </Link>
        </Button>
        <PrintKitButton />
      </div>

      <header className="space-y-1 border-b pb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Signing-day kit</p>
        <h1 className="text-2xl font-semibold">{kit.matterName}</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Client{kit.clients.length === 1 ? '' : 's'}</dt>
          <dd>{kit.clients.length ? kit.clients.join(' and ') : '—'}</dd>
          <dt className="text-muted-foreground">When</dt>
          <dd>{kit.scheduledFor ?? 'Not yet scheduled'}</dd>
          <dt className="text-muted-foreground">Where</dt>
          <dd>{kit.location ?? '—'}</dd>
          <dt className="text-muted-foreground">Prepared</dt>
          <dd>{kit.preparedOn}</dd>
        </dl>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">In the room</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Role</th>
              <th className="py-1 pr-3 font-medium">Name</th>
              <th className="py-1 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {kit.present.map((person, index) => (
              <tr key={`${person.role}-${index}`} className="border-b align-top">
                <td className="py-1 pr-3 font-medium">{person.role}</td>
                <td className="py-1 pr-3">{person.name ?? <span className="text-muted-foreground">__________________</span>}</td>
                <td className="py-1 text-muted-foreground">{person.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {kit.notaryRequired && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {kit.notaryReasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Bring</h2>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {kit.bring.map(line => <li key={line}>{line}</li>)}
        </ul>
      </section>

      <section className="space-y-2 break-inside-avoid">
        <h2 className="text-lg font-semibold">Signing order and tabs</h2>
        <p className="text-sm text-muted-foreground">
          Documents that need witnesses are signed first, while the witnesses are in the room. Place a flag at each tab before the appointment.
        </p>
        <ol className="space-y-3">
          {kit.documents.map(document => (
            <li key={document.kind} className="rounded-md border p-3 break-inside-avoid" data-testid={`kit-document-${document.kind}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{document.order}. {document.label}</span>
                <span className="text-xs text-muted-foreground">
                  {document.witnesses} witness{document.witnesses === 1 ? '' : 'es'} · Notary: {document.notaryLabel.toLowerCase()}
                  {document.selfProving ? ' · self-proving affidavit' : ''}
                </span>
              </div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {document.tabs.map(tab => (
                    <tr key={tab.label} className="border-t">
                      <td className="w-6 py-1 align-top">☐</td>
                      <td className="py-1 pr-3 font-medium">{tab.label}</td>
                      <td className="py-1 text-muted-foreground">{tab.where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {document.recording && (
                <p className="mt-2 text-xs text-muted-foreground">After signing, record at: {document.recording}.</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{document.citation}</p>
            </li>
          ))}
        </ol>
        {kit.unmatchedDocuments.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Not placed, so not in the order above: {kit.unmatchedDocuments.join(', ')}. Confirm each on the Signing view before the appointment.
          </p>
        )}
      </section>

      <section className="space-y-2 break-inside-avoid">
        <h2 className="text-lg font-semibold">For the witnesses</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {kit.witnessInstructions.map(line => <li key={line}>{line}</li>)}
        </ol>
      </section>

      <section className="space-y-2 break-inside-avoid">
        <h2 className="text-lg font-semibold">For the notary</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {kit.notaryInstructions.map(line => <li key={line}>{line}</li>)}
        </ol>
      </section>

      <section className="space-y-2 break-inside-avoid">
        <h2 className="text-lg font-semibold">After signing</h2>
        <ul className="space-y-1 text-sm">
          {kit.afterSigning.map(line => <li key={line}>☐ {line}</li>)}
        </ul>
      </section>

      <section className="space-y-2 break-inside-avoid border-t pt-4 text-sm">
        <h2 className="text-lg font-semibold">Record of the appointment</h2>
        <p className="text-muted-foreground">Fill in at the table, then enter on the Signing view.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
          <dt>Witness 1</dt><dd className="border-b border-dotted">&nbsp;</dd>
          <dt>Witness 2</dt><dd className="border-b border-dotted">&nbsp;</dd>
          <dt>Notary</dt><dd className="border-b border-dotted">&nbsp;</dd>
          <dt>Health care agent</dt><dd className="border-b border-dotted">&nbsp;</dd>
          <dt>Originals kept at</dt><dd className="border-b border-dotted">&nbsp;</dd>
        </dl>
      </section>
    </div>
  )
}
