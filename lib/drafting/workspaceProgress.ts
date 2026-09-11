export function draftingProgress(designComplete: boolean, draftCount: number, drafts: Array<{ reviewedAt: string | null }>, sharedGenerated: Array<{ reviewed_at?: string | null }>) {
  const generated = draftCount > 0 || sharedGenerated.length > 0
  const reviewed = generated && drafts.length === draftCount && drafts.every(doc => Boolean(doc.reviewedAt)) && sharedGenerated.every(doc => Boolean(doc.reviewed_at))
  return { design: designComplete ? 'complete' : 'pending', generate: generated ? 'complete' : 'pending', review: reviewed ? 'complete' : 'pending' } as const
}
