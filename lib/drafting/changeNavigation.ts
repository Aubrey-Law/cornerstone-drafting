// Pure helpers for stepping through tracked changes in the in-app DOCX viewer.
// Kept separate from the DOM/scroll logic so the index math stays unit-testable.

/**
 * Index of the next tracked change to focus when the reviewer presses
 * Prev/Next. Wraps around the ends. Returns -1 for an empty change set.
 *
 * When nothing is focused yet (current < 0), Next starts at the first change
 * and Prev starts at the last.
 */
export function nextChangeIndex(current: number, dir: 1 | -1, length: number): number {
  if (length <= 0) return -1
  if (current < 0) return dir === 1 ? 0 : length - 1
  return (current + dir + length) % length
}

/** Clamp a zoom factor to the range the viewer's +/- controls allow. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(2, Math.max(0.6, Math.round(zoom * 100) / 100))
}
