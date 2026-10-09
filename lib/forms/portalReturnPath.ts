const FORM_PATH = /^\/forms\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Where an invited client lands after the intake link signs them in. A
 * `next` naming one of the portal's client-form pages is honoured (that is how
 * a sent custom form reaches someone without an account yet); anything else
 * opens the questionnaire the link was issued for — not merely the client's
 * oldest, which matters once one person has more than one.
 */
export function portalReturnPath(next: unknown, intakeId: string): string {
  if (typeof next === 'string' && FORM_PATH.test(next)) return next
  return `/intake?id=${encodeURIComponent(intakeId)}`
}
