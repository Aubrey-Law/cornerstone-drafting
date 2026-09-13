import type { MatterContext } from '../api/client'

/**
 * Whether to warn that a reply was written without the design sheet.
 *
 * Kept out of the component so it can be tested: the add-in's vitest run
 * collects `src/**‍/*.test.ts` in a node environment, with no DOM and no React.
 *
 * Only warns when a matter is linked. With none, drafting from the document
 * alone is what the attorney asked for and a banner would be noise. With one
 * linked, anything other than `applied` means the model answered about this
 * client's documents without this client's facts — the case where a confident,
 * invented fiduciary is both most likely and least visible.
 */
export function describeContextGap(
  matterId: string | null,
  context: MatterContext,
): string | null {
  if (!matterId || context.state === 'applied') return null
  const detail = context.state === 'unavailable' ? ` ${context.reason}` : ''
  return `This reply was written WITHOUT the linked matter's design sheet.${detail} Treat any name, date or appointment in it as unsourced.`
}
