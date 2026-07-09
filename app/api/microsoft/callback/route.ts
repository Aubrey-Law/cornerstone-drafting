/**
 * OAuth redirect alias — Entra / Vercel configs often use /api/microsoft/callback
 * instead of /api/admin/microsoft/callback. Handler is identical.
 */
export { GET } from '../../admin/microsoft/callback/route'
