import { listStyleSets } from '@/lib/styleSets/data'
import { StyleSetsClient, type StyleSetSummary } from './StyleSetsClient'

export const dynamic = 'force-dynamic'

export default async function StyleSetsPage() {
  let styleSets: StyleSetSummary[] = []
  let error: string | null = null

  try {
    styleSets = (await listStyleSets()) as StyleSetSummary[]
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Unknown error'
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Style sets</h1>
        <p role="alert" className="text-sm text-destructive">
          Could not load style sets ({error}).
        </p>
      </div>
    )
  }

  return <StyleSetsClient initialStyleSets={styleSets} />
}
