import type { DesignSheetChild } from '@/types/database'

/** True when at least one child on the design sheet is marked minor. */
export function sheetHasMinorChildren(
  children: DesignSheetChild[] | null | undefined,
): boolean {
  return (children ?? []).some(child => child.is_minor === true)
}

/** Minor children on the design sheet (for UI hints). */
export function sheetMinorChildren(
  children: DesignSheetChild[] | null | undefined,
): DesignSheetChild[] {
  return (children ?? []).filter(child => child.is_minor === true)
}
