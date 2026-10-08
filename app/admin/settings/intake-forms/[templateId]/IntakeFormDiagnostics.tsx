'use client'

import type { IntakeFormDiagnostic } from '@/lib/intake/forms/compiler'

export function IntakeFormDiagnostics({ diagnostics, onNavigate }: {
  diagnostics: IntakeFormDiagnostic[]
  onNavigate: (diagnostic: IntakeFormDiagnostic) => void
}) {
  return <section aria-labelledby="intake-diagnostics-heading" className="rounded-lg border bg-muted p-4">
    <h2 id="intake-diagnostics-heading" className="font-medium">Form checks</h2>
    <p className="text-sm text-muted-foreground" role="status">{diagnostics.length ? `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'} to resolve before publishing` : 'No form issues found'}</p>
    {diagnostics.length > 0 && <ul className="mt-2 space-y-2">{diagnostics.map(diagnostic => <li key={JSON.stringify([diagnostic.path, diagnostic.message])}>
      <button type="button" onClick={() => onNavigate(diagnostic)} className="text-left text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{diagnostic.message}</button>
    </li>)}</ul>}
  </section>
}
