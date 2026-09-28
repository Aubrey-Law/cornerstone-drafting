/**
 * The app's status colours, in one place. Badges, callouts and severity
 * notices use the same amber / green / red / blue tokens the rest of the app
 * uses (billing, tasks, documents) rather than each screen mixing its own.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** For `<Badge variant="outline" className={TONE_BADGE[tone]}>`. */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-blue-strong-border bg-blue-bg text-blue',
  success: 'border-green/30 bg-green-bg text-green',
  warning: 'border-amber-border bg-amber-bg text-amber',
  danger: 'border-destructive/30 bg-red-bg text-destructive',
}

/** For a bordered callout or list item that carries a tone. */
export const TONE_NOTICE: Record<Tone, string> = {
  neutral: 'rounded-lg border border-border bg-muted p-3 text-sm',
  info: 'rounded-lg border border-blue-strong-border bg-blue-bg p-3 text-sm',
  success: 'rounded-lg border border-green/30 bg-green-bg p-3 text-sm',
  warning: 'rounded-lg border border-amber-border bg-amber-bg p-3 text-sm',
  danger: 'rounded-lg border border-destructive/30 bg-red-bg p-3 text-sm',
}

/** Review and field-audit finding severities. Unknown or missing reads as low. */
export function severityTone(severity: string | null | undefined): Tone {
  switch (severity) {
    case 'blocker':
      return 'danger'
    case 'high':
    case 'medium':
      return 'warning'
    default:
      return 'neutral'
  }
}
