/**
 * Why a sign-in failed, told apart carefully.
 *
 * Reporting "that password is incorrect" when the auth service is simply
 * unreachable sends the user to reset a password that was never the problem —
 * during an outage, which is when they can least afford the detour. So a
 * rejected credential has to be positively identified from the response, and
 * everything else, including anything unrecognised, is reported as a service
 * that could not be reached.
 */

export type SignInFailure = 'rejected' | 'unavailable'

/** Shape shared by supabase-js's AuthApiError and AuthRetryableFetchError. */
export type SignInErrorLike = {
  status?: number | null
  name?: string
  code?: string
} | null

const REJECTION_STATUSES = new Set([400, 401, 403])
const REJECTION_CODES = new Set(['invalid_credentials', 'invalid_grant'])

export function classifySignInError(error: SignInErrorLike): SignInFailure {
  if (!error) return 'unavailable'
  if (error.code && REJECTION_CODES.has(error.code)) return 'rejected'
  if (typeof error.status === 'number' && REJECTION_STATUSES.has(error.status)) return 'rejected'
  return 'unavailable'
}

export function signInMessage(failure: SignInFailure): string {
  // Deliberately not "no account with that email": that answer confirms which
  // addresses have accounts to anyone who asks.
  if (failure === 'rejected') return 'That email or password is incorrect.'
  return 'We could not reach the sign-in service. Please try again in a moment.'
}
