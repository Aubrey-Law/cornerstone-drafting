/** Minimum length for client portal passwords (matches reset-password flow). */
export const MIN_CLIENT_PASSWORD_LENGTH = 8

/** Returns a user-facing error message, or null when valid. */
export function validateNewClientPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_CLIENT_PASSWORD_LENGTH) {
    return `Use at least ${MIN_CLIENT_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirm) {
    return 'Passwords do not match.'
  }
  return null
}

export function isExistingAccountAuthError(message: string): boolean {
  return /already.*registered|user already registered|already been registered|exists/i.test(message)
}
