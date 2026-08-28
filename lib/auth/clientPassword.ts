/** Minimum length for client portal passwords. */
export const MIN_CLIENT_PASSWORD_LENGTH = 8

export function isExistingAccountAuthError(message: string): boolean {
  return /already.*registered|user already registered|already been registered|exists/i.test(message)
}
