'use client'

import { ClientErrorState } from '@/components/ClientErrorState'

/**
 * The questionnaire is long, so the first thing a client wants to know is
 * whether their answers are gone.
 *
 * They are not: GuidedInterview saves through `useAutoSave` as they go. That
 * save is debounced, though, so the last moment's typing may not have landed —
 * which is why the wording is "the last moment's typing" rather than a flat
 * promise that nothing was lost.
 */
export default function IntakeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ClientErrorState
      error={error}
      reset={reset}
      title="We could not load your questionnaire"
      detail="Your answers are saved as you go, so you should not lose more than the last moment's typing. Try again and you will pick up where you left off."
    />
  )
}
