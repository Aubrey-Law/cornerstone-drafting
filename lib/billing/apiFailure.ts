import { NextResponse } from 'next/server'

/**
 * Maps a Postgres error from a billing RPC onto an HTTP status.
 *
 * The RPCs raise with deliberate SQLSTATEs so the API layer never has to match
 * on message text:
 *   42501  actor is not attorney/admin
 *   P0002  row not found
 *   22003  numeric out of range — an over-balance payment
 *   22023  invalid parameter — a rule violation the caller can fix
 *   23514  a CHECK constraint the RPC did not catch first
 */
export function billingFailure(error: { code?: string; message: string }) {
  const status =
    error.code === '42501' ? 403
      : error.code === 'P0002' ? 404
        : error.code === '22003' || error.code === '22023' || error.code === '23514' ? 409
          : 500
  return NextResponse.json({ error: error.message }, { status })
}
