export function shouldConsumeDesignFocus(rawFocus: string | null, consumedFocus: string | null): boolean {
  return Boolean(rawFocus && rawFocus !== consumedFocus)
}

export function nextConsumedDesignFocus(rawFocus: string | null, consumedFocus: string | null): string | null {
  return rawFocus === null ? null : consumedFocus
}

export interface DesignInitialFocus {
  sectionId: string
  targetField: string | null
}

/**
 * A focus request scrolls/highlights its target at most once, and only while its
 * target section is active. Gate on the focus object's identity — not on render
 * count — because the scroll effect also re-runs when the active section def is
 * rebuilt, which happens on every sheet edit. Without this guard, each choice the
 * attorney makes bounces the viewport back to the focus target.
 */
export function shouldApplyDesignInitialFocus(
  focus: DesignInitialFocus | null,
  activeSectionId: string | null,
  appliedFocus: DesignInitialFocus | null,
): boolean {
  if (!focus || !activeSectionId) return false
  if (focus.sectionId !== activeSectionId) return false
  return focus !== appliedFocus
}
