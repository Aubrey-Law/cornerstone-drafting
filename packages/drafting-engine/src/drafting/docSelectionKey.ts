export interface DraftDocSelectionKeyInput {
  doc_type: string | null
  variant?: string | null
  party?: string | null
}

export function docSelectionTemplateKey(selection: DraftDocSelectionKeyInput): string | null {
  const docType = selection.doc_type?.trim()
  if (!docType) return null

  const variant = selection.variant?.trim()
  const baseKey = variant ? `${docType}:${variant}` : docType
  return selection.party?.trim().toLowerCase() === 'spouse' ? `${baseKey}:spouse` : baseKey
}
