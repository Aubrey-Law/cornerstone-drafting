/**
 * The words for a failure, whatever was thrown.
 *
 * supabase-js does not throw: it returns an error object, and `if (error)
 * throw error` rethrows whatever that was. A Postgres error is an Error
 * instance; a network failure is a plain `{ message, details, hint, code }`,
 * and `String()` of that is "[object Object]" — which is what the 14 September
 * run recorded when the database gateway was down, and why it is worth reading
 * the message off anything that carries one.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const { message, code } = err as { message?: unknown; code?: unknown }
    if (typeof message === 'string' && message) {
      return typeof code === 'string' && code ? `${message} (${code})` : message
    }
  }
  return String(err)
}
