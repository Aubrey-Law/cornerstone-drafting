/**
 * Whether the engagement approval secret is configured.
 *
 * Separate from `lib/engagement/approval.ts`, which throws when the secret is
 * missing because by then something is mid-flight and cannot continue. This
 * only asks the question, so a readiness probe can report the answer instead of
 * a staff member discovering it at the approve button.
 *
 * It lives here rather than in the health route because a Next.js route file may
 * only export its handlers and config — the same reason `isSmsConfigured` lives
 * in lib/communications/config.ts rather than beside `checkCommunications`.
 */
export function isEngagementApprovalConfigured(): boolean {
  return Boolean(process.env.ENGAGEMENT_APPROVAL_SECRET?.trim())
}
