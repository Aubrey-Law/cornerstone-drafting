import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { intakeTrackForPracticeArea } from './reconcileMatterIntakeTrack'
import { getIntakeTrack } from '@/lib/intakeTrack'

/** Read server-owned context before creating a new intake, never on updates. */
export async function loadIntakeCreationContext(
  admin: SupabaseClient,
  source: { matterId?: string | null; leadId?: string | null },
) {
  if (source.matterId) {
    const { data, error } = await admin.from('matter_details').select('practice_area').eq('matter_id', source.matterId).maybeSingle()
    if (error) throw new Error('Unable to determine the questionnaire for this matter')
    return { practice_area: data?.practice_area ?? null, intake_track: intakeTrackForPracticeArea(data?.practice_area) }
  }
  if (source.leadId) {
    const { data, error } = await admin.from('client_intake').select('practice_area, intake_track').eq('id', source.leadId).maybeSingle()
    if (error || !data) throw new Error('Unable to determine the questionnaire for this lead')
    return {
      practice_area: data.practice_area ?? null,
      intake_track: data.practice_area ? intakeTrackForPracticeArea(data.practice_area) : getIntakeTrack(data),
    }
  }
  return { practice_area: null, intake_track: 'estate' as const }
}
