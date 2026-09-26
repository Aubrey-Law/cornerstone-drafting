import { loadRunSummaries } from '@/lib/review/history'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { RunHistoryList } from './components/RunHistoryList'

export const dynamic = 'force-dynamic'

/**
 * Every recorded review, newest first: reviews of filed documents, of uploaded
 * prior plans, and those run from the Word add-in's Review tab.
 */
export default async function ReviewHistoryPage() {
  await requireStaffPage()
  const runs = await loadRunSummaries(reviewClient(), 100)

  return (
    <div className="space-y-4 px-6 py-5">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Playbook reviews and their findings. Reviews run from the Review tab in Word are saved here, with a copy of
          the document as it was in Word.
        </p>
      </header>
      {runs.length > 0 ? (
        <RunHistoryList runs={runs} />
      ) : (
        <p className="text-sm text-muted-foreground">No reviews yet. Run one from the Review tab in Word.</p>
      )}
    </div>
  )
}
