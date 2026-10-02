/** Matches Tailwind's `lg` breakpoint, where the list/detail layouts sit side by side. */
const SIDE_BY_SIDE = '(min-width: 1024px)'

/**
 * On a narrow screen a list/detail layout stacks, so the detail a click just
 * opened sits below the whole list. Scroll it into view there; do nothing when
 * the two sit side by side. Tolerates environments without `matchMedia` or
 * `scrollIntoView` (jsdom), where a click must not throw.
 */
export function revealOnNarrowScreen(target: () => Element | null | undefined): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  if (window.matchMedia(SIDE_BY_SIDE).matches) return
  requestAnimationFrame(() => {
    const element = target()
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
}
