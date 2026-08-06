import { FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * File-manager iconography: a coloured tile carrying the extension, so a list
 * of a dozen files can be scanned by type without reading a single name.
 */
const TILES: Record<string, { className: string; label: string }> = {
  pdf: { className: 'bg-red-bg text-destructive', label: 'PDF' },
  docx: { className: 'bg-blue-bg text-blue', label: 'DOC' },
  doc: { className: 'bg-blue-bg text-blue', label: 'DOC' },
  xlsx: { className: 'bg-green-bg text-green', label: 'XLS' },
  xls: { className: 'bg-green-bg text-green', label: 'XLS' },
  csv: { className: 'bg-green-bg text-green', label: 'CSV' },
  png: { className: 'bg-amber-bg text-amber', label: 'IMG' },
  jpg: { className: 'bg-amber-bg text-amber', label: 'IMG' },
  jpeg: { className: 'bg-amber-bg text-amber', label: 'IMG' },
  txt: { className: 'bg-muted text-muted-foreground', label: 'TXT' },
}

export function DocumentTypeIcon({ name, className }: { name: string; className?: string }) {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const tile = TILES[extension]
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md text-[9px] font-bold tracking-tight',
        tile?.className ?? 'bg-muted text-muted-foreground',
        className,
      )}
      aria-hidden
    >
      {tile ? tile.label : <FileText className="size-4" />}
    </span>
  )
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-bg',
        className,
      )}
      aria-hidden
    >
      <Folder className="size-4 fill-amber text-amber" />
    </span>
  )
}
