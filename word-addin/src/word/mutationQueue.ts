/**
 * One document, one writer at a time.
 *
 * Two overlapping `Word.run` batches against the same document corrupt each
 * other's state — the second can read ranges the first has already invalidated.
 * React makes this easy to hit by accident: a click handler and an effect can
 * both start a batch in the same tick. Every mutation goes through here.
 */
let tail: Promise<unknown> = Promise.resolve()

export function serializeWordMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = tail.then(operation, operation)
  // Keep the chain alive after a rejection so one failed edit does not wedge
  // every later mutation.
  tail = run.catch(() => undefined)
  return run
}
