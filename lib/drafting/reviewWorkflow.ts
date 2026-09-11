interface ReviewDraft {
  id: string
  name: string
  created_at: string
  reviewedAt: string | null
}

export function groupDraftHistory<T extends ReviewDraft>(current: T[], history: T[]): Array<{ current: T; previous: T[] }> {
  return current.map(doc => ({
    current: doc,
    previous: history.filter(old => old.name.toLowerCase() === doc.name.toLowerCase())
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)),
  }))
}

export function nextUnreviewedDraft<T extends ReviewDraft>(drafts: T[], currentId: string | null): T | null {
  const index = drafts.findIndex(d => d.id === currentId)
  const ordered = [...drafts.slice(index + 1), ...drafts.slice(0, index + 1)]
  return ordered.find(d => /\.docx?$/i.test(d.name) && !d.reviewedAt && d.id !== currentId) ?? null
}

export type ConversionResult = { id: string; name: string; status: 'converted' | 'failed'; error?: string }
export async function runSelectedConversion<T extends { id: string; name: string }>(
  documents: T[], selected: Set<string>, convert: (document: T) => Promise<void>,
): Promise<ConversionResult[]> {
  const results: ConversionResult[] = []
  for (const doc of documents.filter(d => selected.has(d.id) && /\.docx$/i.test(d.name))) {
    try {
      await convert(doc)
      results.push({ id: doc.id, name: doc.name, status: 'converted' })
    } catch (error) {
      results.push({ id: doc.id, name: doc.name, status: 'failed', error: error instanceof Error ? error.message : 'Conversion failed' })
    }
  }
  return results
}
