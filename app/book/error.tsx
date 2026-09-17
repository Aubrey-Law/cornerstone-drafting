'use client'

import { ClientErrorState } from '@/components/ClientErrorState'

/**
 * Booking covers both the public page and the manage-my-booking link, so the
 * wording has to hold for someone making a first appointment and for someone
 * moving or cancelling one.
 *
 * As on the signing page, it does not assert that nothing happened — a render
 * can fail after the request succeeded. Checking for the confirmation email
 * before trying again is the instruction that is right either way.
 */
export default function BookError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ClientErrorState
      error={error}
      reset={reset}
      title="We could not load the booking page"
      detail="Trying again is safe. If you had just booked or changed an appointment, check your email for a confirmation before booking a second time — and call us if none arrives."
    />
  )
}
