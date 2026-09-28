import { IntegrationError } from '@/lib/integrations/errors'
import { isMercuryConfigured, loadMercuryDepositProposals } from '@/lib/integrations/mercury/deposits'
import { MercuryDepositsCard } from './MercuryDepositsCard'

/**
 * Server component, so it reads Mercury directly rather than fetching its own
 * API route — the same shape the Reports view uses.
 *
 * Renders nothing at all when Mercury is unconfigured: an absent integration
 * should leave the page exactly as it was.
 */
export async function MercuryDeposits() {
  if (!isMercuryConfigured()) return null

  try {
    const view = await loadMercuryDepositProposals({ days: 30 })
    return <MercuryDepositsCard view={view} />
  } catch (error) {
    // A dead or expired token is the expected failure here — Mercury deletes a
    // token after 45 days of no activity — so it reads as a line, not a crash.
    const message = error instanceof IntegrationError && error.kind === 'attention'
      ? 'Reconnect Mercury to see bank deposits.'
      : 'Bank deposits are temporarily unavailable.'
    if (!(error instanceof IntegrationError)) {
      console.error('[mercury deposits]', error instanceof Error ? error.message : error)
    }
    return <p className="text-xs text-muted-foreground">{message}</p>
  }
}
