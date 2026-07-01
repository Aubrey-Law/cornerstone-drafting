// Deciding which prior drafts a new generation run replaces.
//
// Draft names are `YYYY-MM-DD_Owner_Title.docx`; the date prefix varies per run,
// so the owner+title remainder is a document's stable identity across runs.

export function stableDraftKey(name: string): string {
  return name.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/\.docx$/i, '')
}

export interface SelectSupersededArgs {
  /** Current (non-superseded) draft rows captured before this run inserted. */
  priorDrafts: Array<{ id: string; name: string }>
  /** Document names produced by this run. */
  regeneratedNames: string[]
  /** True when this run generated the full document set (no subset selected). */
  fullSet: boolean
}

/**
 * The ids of prior drafts replaced by this run. A full-set run supersedes every
 * prior draft; a subset run only supersedes prior drafts whose title it
 * regenerated, leaving untouched documents active.
 */
export function selectSupersededDraftIds({ priorDrafts, regeneratedNames, fullSet }: SelectSupersededArgs): string[] {
  const regeneratedKeys = new Set(regeneratedNames.map(stableDraftKey))
  return priorDrafts
    .filter(prior => fullSet || regeneratedKeys.has(stableDraftKey(prior.name)))
    .map(prior => prior.id)
}
