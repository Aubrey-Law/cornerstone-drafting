export interface DraftingMetrics {
  runs: number
  completed: number
  needsAttention: number
  averageRunSeconds: number | null
  reviewedDocuments: number
  averageReviewSeconds: number | null
}
export function formatElapsed(seconds: number | null): string {
  if (seconds === null) return 'No completed samples'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hr`
  return `${(seconds / 86400).toFixed(1)} days`
}
