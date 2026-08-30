'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * The list pages' "Export CSV" control.
 *
 * The work itself differs by page — the leads list asks the server for the
 * whole filtered set, the matters list writes the rows it already holds — so
 * the button owns only what is common: the pending state, and turning a
 * failure into a toast rather than a silent no-op.
 */
export function ExportCsvButton({
  onExport,
  label = 'Export CSV',
  pendingLabel = 'Exporting…',
  disabled = false,
  title,
}: {
  onExport: () => void | Promise<void>
  label?: string
  pendingLabel?: string
  disabled?: boolean
  title?: string
}) {
  const [exporting, setExporting] = useState(false)

  async function run() {
    setExporting(true)
    try {
      await onExport()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || exporting}
      onClick={() => void run()}
      title={title}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {exporting ? pendingLabel : label}
    </Button>
  )
}
