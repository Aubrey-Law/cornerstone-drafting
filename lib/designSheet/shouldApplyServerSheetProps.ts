import { parseUpdatedAt } from '@/lib/designSheet/updatedAt'

export type ServerSheetPropsDecision =
  | { action: 'ignore' }
  | { action: 'acknowledge' }
  | { action: 'apply' }

/**
 * Decide how client design-sheet state should react to a new sheetProp.updated_at.
 *
 * - ignore: same stamp already applied, or props are older than the last local save
 * - acknowledge: props caught up to the local save watermark — keep local sheet
 * - apply: props are newer than both the last applied stamp and the local save
 */
export function shouldApplyServerSheetProps(args: {
  stamp: string | null
  propsSheetStamp: string | null
  serverSheetStamp: string | null
  saveStatus: 'saved' | 'dirty' | 'saving' | 'error'
  /** Once the attorney has edited this session, never rebuild from RSC props. */
  hasLocalEdits?: boolean
}): ServerSheetPropsDecision {
  const { stamp, propsSheetStamp, serverSheetStamp, saveStatus, hasLocalEdits = false } = args
  if (!stamp || stamp === propsSheetStamp) return { action: 'ignore' }
  if (saveStatus === 'dirty' || saveStatus === 'saving') return { action: 'ignore' }

  const propsMs = parseUpdatedAt(stamp)
  const savedMs = parseUpdatedAt(serverSheetStamp)
  if (propsMs != null && savedMs != null && propsMs < savedMs) return { action: 'ignore' }
  // After any local edit/save, keep client state authoritative for this session.
  // RSC payloads can lag or carry pre-edit decisions with a newer updated_at.
  if (hasLocalEdits || (propsMs != null && savedMs != null && propsMs === savedMs)) {
    return { action: 'acknowledge' }
  }
  return { action: 'apply' }
}
