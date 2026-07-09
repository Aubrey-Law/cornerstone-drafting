import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SetupBannerProps {
  feature: string
  detail: string
  settingsHref?: string
  className?: string
}

export function SetupBanner({
  feature,
  detail,
  settingsHref = '/admin/settings',
  className,
}: SetupBannerProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber',
        className,
      )}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">{feature} is not configured.</span>{' '}
        {detail}{' '}
        <Link href={settingsHref} className="font-medium underline underline-offset-2">
          Open settings
        </Link>
      </p>
    </div>
  )
}
