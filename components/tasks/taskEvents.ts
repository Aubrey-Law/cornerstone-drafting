/**
 * ⌘⇧T is a global shortcut, but what it opens depends on where you are: the
 * Tasks page focuses its own composer, everywhere else the rail's Tasks tab
 * takes it. The rail dispatches this so the page can claim the shortcut when it
 * is mounted.
 */
export const OPEN_TASK_CAPTURE_EVENT = 'cornerstone:task-capture'

export function requestTaskCapture() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_TASK_CAPTURE_EVENT))
}
