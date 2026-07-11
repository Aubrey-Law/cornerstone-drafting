export function shouldConsumeDesignFocus(rawFocus: string | null, consumedFocus: string | null): boolean {
  return Boolean(rawFocus && rawFocus !== consumedFocus)
}

export function nextConsumedDesignFocus(rawFocus: string | null, consumedFocus: string | null): string | null {
  return rawFocus === null ? null : consumedFocus
}
