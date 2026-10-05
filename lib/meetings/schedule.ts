import { after } from 'next/server'

export interface MeetingFollowUpRequest {
  matterId?: string | null
  leadId?: string | null
  title: string
  meetingDate: string
  content: string
  actorId: string
  sourceKey: string
}

/**
 * Queues the meeting follow-up behind the response, so saving a note stays
 * quick while the reading and the proposals happen in the seconds after.
 * Nothing here can fail the save: the work runs after the response is sent,
 * and every error inside it is logged, not thrown.
 */
export function scheduleMeetingFollowUp(input: MeetingFollowUpRequest): void {
  const run = async () => {
    try {
      const { runMeetingFollowUp } = await import('@/lib/meetings/followUp')
      await runMeetingFollowUp(input)
    } catch (error) {
      console.error('[meetings] follow-up failed', {
        sourceKey: input.sourceKey,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }
  try {
    after(run)
  } catch {
    // Outside a request scope (tests, scripts) there is no "after"; run inline.
    void run()
  }
}
