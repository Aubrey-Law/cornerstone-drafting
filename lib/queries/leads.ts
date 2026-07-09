/** Cornerstone Lite stub — full leads CRM lives in aubrey-law-app. */

export async function insertCrmActivity(_args: {
  lead_id: string
  type: string
  payload: Record<string, unknown>
  actor_user_id: string | null
}): Promise<void> {
  // no-op in lite mode
}
