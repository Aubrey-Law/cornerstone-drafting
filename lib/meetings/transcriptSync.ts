import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { attendeeEmailsFrom, matchMeetingToRecord, type MatchableAppointment, type MatchableRecord, type MeetingRecordMatch } from '@/lib/meetings/transcriptMatch'
import { vttToTranscriptText } from '@/lib/meetings/transcriptText'

/**
 * The meeting-transcripts sweep.
 *
 * Twice an hour it asks the two places a meeting's record ends up, Granola
 * and Microsoft Teams, for anything new, puts each note on the matter or
 * lead the meeting belonged to, and hands it to the meeting follow-up, which
 * proposes the design decisions, the attorney's to-dos and the client recap
 * through the delegation dial. Nothing is read twice: every transcript it has
 * looked at is written to `meeting_transcript_imports`, matched or not.
 *
 * It only acts when the record is certain. A meeting whose attendees match
 * no record, or more than one, is recorded as skipped and left for a person
 * to place from the "Add meeting notes" dialog, which still works as before.
 */

const MAX_NOTES_PER_RUN = 5
/** Granola summaries and Teams transcripts take a few minutes after a meeting ends. */
const TEAMS_SETTLE_MS = 15 * 60 * 1000
const MIN_CONTENT_CHARS = 40

export type TranscriptProvider = 'granola' | 'microsoft_teams'

export interface TranscriptSyncOutcome {
  provider: TranscriptProvider
  externalId: string
  title: string
  outcome: 'imported' | 'skipped' | 'pending' | 'failed'
  record?: { kind: 'matter' | 'lead'; id: string }
  reason?: string
  followUp?: { outcomes: number; designFieldCount: number; designFiduciaryCount: number }
}

export interface TranscriptSyncResult {
  ok: true
  actorId: string | null
  granola: 'not_configured' | 'swept' | 'failed'
  teams: 'not_connected' | 'reconnect_needed' | 'swept' | 'failed'
  notes: TranscriptSyncOutcome[]
  errors: string[]
}

interface SweepContext {
  admin: ReturnType<typeof getAdminClient>
  actorId: string
  now: number
  sinceDays: number
  imported: Set<string>
  budget: { remaining: number }
  records: Promise<{
    appointments: MatchableAppointment[]
    matters: MatchableRecord[]
    leads: MatchableRecord[]
    staffEmails: string[]
  }>
  result: TranscriptSyncResult
}

const importKey = (provider: TranscriptProvider, externalId: string) => `${provider}:${externalId}`

export async function runMeetingTranscriptSync(options: { now?: Date; sinceDays?: number } = {}): Promise<TranscriptSyncResult> {
  const now = (options.now ?? new Date()).getTime()
  const sinceDays = options.sinceDays ?? 7
  const admin = getAdminClient()
  const result: TranscriptSyncResult = { ok: true, actorId: null, granola: 'not_configured', teams: 'not_connected', notes: [], errors: [] }

  const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
  const actor = await resolveUnattendedActor()
  if (!actor) {
    result.errors.push('No staff user to act as; the sweep did nothing.')
    return result
  }
  result.actorId = actor.id

  const sinceIso = new Date(now - sinceDays * 86_400_000).toISOString()
  const { data: importedRows, error: importedError } = await admin
    .from('meeting_transcript_imports')
    .select('provider, external_id')
    .gte('imported_at', new Date(now - (sinceDays + 30) * 86_400_000).toISOString())
  if (importedError) {
    result.errors.push(`Could not read the import ledger: ${importedError.message}`)
    return result
  }
  const context: SweepContext = {
    admin,
    actorId: actor.id,
    now,
    sinceDays,
    imported: new Set((importedRows ?? []).map(row => importKey(row.provider as TranscriptProvider, String(row.external_id)))),
    budget: { remaining: MAX_NOTES_PER_RUN },
    records: loadMatchableRecords(admin, sinceIso, now),
    result,
  }

  await sweepGranola(context)
  await sweepTeams(context)
  return result
}

async function loadMatchableRecords(admin: SweepContext['admin'], sinceIso: string, now: number) {
  const [appointmentsRes, mattersRes, leadsRes, staffRes] = await Promise.all([
    admin.from('appointments')
      .select('id, start_time, attendee_email, second_attendee_email, linked_matter_id, linked_lead_id, attendee_name')
      .gte('start_time', sinceIso)
      .lte('start_time', new Date(now + 86_400_000).toISOString())
      .neq('status', 'cancelled'),
    admin.from('v_matter_pipeline').select('matter_id, client_name, client_email').eq('relationship_status', 'hired'),
    admin.from('client_intake').select('id, email, full_name').eq('lead_status', 'lead').not('email', 'is', null),
    admin.from('users').select('email').in('role', ['admin', 'attorney']),
  ])
  const appointments: MatchableAppointment[] = (appointmentsRes.data ?? []).map(row => ({
    id: String(row.id),
    startIso: String(row.start_time),
    attendeeEmails: [row.attendee_email, row.second_attendee_email]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map(value => value.toLowerCase()),
    matterId: typeof row.linked_matter_id === 'string' ? row.linked_matter_id : null,
    leadId: typeof row.linked_lead_id === 'string' ? row.linked_lead_id : null,
    label: typeof row.attendee_name === 'string' ? row.attendee_name : null,
  }))
  const matters: MatchableRecord[] = (mattersRes.data ?? [])
    .filter(row => typeof row.client_email === 'string' && row.client_email)
    .map(row => ({ id: String(row.matter_id), email: String(row.client_email).toLowerCase(), name: typeof row.client_name === 'string' ? row.client_name : null }))
  const leads: MatchableRecord[] = (leadsRes.data ?? [])
    .filter(row => typeof row.email === 'string' && row.email)
    .map(row => ({ id: String(row.id), email: String(row.email).toLowerCase(), name: typeof row.full_name === 'string' ? row.full_name : null }))
  const staffEmails = (staffRes.data ?? [])
    .map(row => (typeof row.email === 'string' ? row.email.toLowerCase() : ''))
    .filter(Boolean)
  return { appointments, matters, leads, staffEmails }
}

async function matchRecord(context: SweepContext, attendeeEmails: string[], startIso: string | null): Promise<MeetingRecordMatch> {
  const records = await context.records
  return matchMeetingToRecord({
    attendeeEmails,
    startIso,
    appointments: records.appointments,
    matters: records.matters,
    leads: records.leads,
    staffEmails: records.staffEmails,
    staffDomains: ['aubreylegal.com'],
  })
}

async function recordImport(context: SweepContext, row: {
  provider: TranscriptProvider
  externalId: string
  title: string
  meetingDate: string
  record: MeetingRecordMatch
  noteId: string | null
  skippedReason: string | null
}) {
  const { error } = await context.admin.from('meeting_transcript_imports').upsert({
    provider: row.provider,
    external_id: row.externalId,
    record_type: row.record.kind,
    record_id: row.record.kind === 'none' ? null : row.record.id,
    note_id: row.noteId,
    title: row.title.slice(0, 300),
    meeting_date: row.meetingDate,
    skipped_reason: row.skippedReason,
    actor_id: context.actorId,
  }, { onConflict: 'provider,external_id' })
  if (error) context.result.errors.push(`Could not record ${row.provider} ${row.externalId}: ${error.message}`)
  context.imported.add(importKey(row.provider, row.externalId))
}

/**
 * Save a matched transcript on its record and run the follow-up. Returns the
 * note id, or null with the reason it could not be saved.
 */
async function landTranscript(context: SweepContext, input: {
  provider: TranscriptProvider
  externalId: string
  record: Extract<MeetingRecordMatch, { kind: 'matter' | 'lead' }>
  title: string
  meetingDate: string
  content: string
  attendees: string[]
  sourceUrl: string | null
}): Promise<{ noteId: string } | { noteId: null; reason: string }> {
  const sourceLabel = input.provider === 'granola' ? 'granola' : 'microsoft_teams'
  let noteId: string
  if (input.record.kind === 'matter') {
    const { saveMatterMeetingNote, MatterMeetingNoteError } = await import('@/lib/meetings/saveMatterMeetingNote')
    try {
      const saved = await saveMatterMeetingNote({
        matterId: input.record.id,
        title: input.title,
        meetingDate: input.meetingDate,
        content: input.content,
        source: sourceLabel,
        sourceUrl: input.sourceUrl ?? undefined,
        attendees: input.attendees,
        actorId: context.actorId,
      })
      noteId = saved.document.id
    } catch (error) {
      if (error instanceof MatterMeetingNoteError && error.code) return { noteId: null, reason: error.code }
      return { noteId: null, reason: `save_failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  } else if (input.provider === 'granola') {
    const { data, error } = await context.admin.rpc('import_lead_granola_note_with_activity', {
      p_lead_id: input.record.id, p_title: input.title, p_meeting_date: input.meetingDate,
      p_attendees: input.attendees, p_body: input.content, p_granola_note_id: input.externalId, p_actor_id: context.actorId,
    })
    if (error) return { noteId: null, reason: `save_failed: ${error.message}` }
    const row = Array.isArray(data) ? data[0] : data
    const note = (row as { meeting_note?: { id?: string } } | null)?.meeting_note
    if (!note?.id) return { noteId: null, reason: 'save_failed: import returned no note' }
    noteId = note.id
  } else {
    const { data, error } = await context.admin.rpc('create_lead_meeting_note_with_activity', {
      p_lead_id: input.record.id, p_title: input.title, p_meeting_date: input.meetingDate,
      p_attendees: input.attendees, p_body: input.content, p_actor_id: context.actorId,
    })
    if (error) return { noteId: null, reason: `save_failed: ${error.message}` }
    const id = (data as { id?: string } | null)?.id
    if (!id) return { noteId: null, reason: 'save_failed: note returned no id' }
    noteId = id
  }

  // The follow-up is the point of the sweep, so it runs here and is awaited:
  // the cron's own time budget covers it, and its outcomes ride in the result.
  try {
    const { runMeetingFollowUp } = await import('@/lib/meetings/followUp')
    const followUp = await runMeetingFollowUp({
      matterId: input.record.kind === 'matter' ? input.record.id : null,
      leadId: input.record.kind === 'lead' ? input.record.id : null,
      title: input.title,
      meetingDate: input.meetingDate,
      content: input.content,
      actorId: context.actorId,
      sourceKey: noteId,
    })
    const last = context.result.notes[context.result.notes.length - 1]
    if (last && last.externalId === input.externalId) {
      last.followUp = { outcomes: followUp.outcomes.length, designFieldCount: followUp.designFieldCount, designFiduciaryCount: followUp.designFiduciaryCount }
    }
  } catch (error) {
    context.result.errors.push(`Follow-up failed for ${input.provider} ${input.externalId}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { noteId }
}

async function processTranscript(context: SweepContext, input: {
  provider: TranscriptProvider
  externalId: string
  title: string
  meetingDate: string
  startIso: string | null
  attendeeEmails: string[]
  attendees: string[]
  sourceUrl: string | null
  /** Loads the content once the meeting is matched; a 'pending' result means try again next run. */
  load: () => Promise<string | 'pending'>
  /** A record already named by the source (a Teams appointment's own link). */
  knownRecord?: Extract<MeetingRecordMatch, { kind: 'matter' | 'lead' }> | null
}) {
  const match = input.knownRecord ?? await matchRecord(context, input.attendeeEmails, input.startIso)
  const base = { provider: input.provider, externalId: input.externalId, title: input.title }
  if (match.kind === 'none') {
    context.result.notes.push({ ...base, outcome: 'skipped', reason: match.reason })
    await recordImport(context, { ...base, meetingDate: input.meetingDate, record: match, noteId: null, skippedReason: match.reason })
    return
  }
  let content: string | 'pending'
  try {
    content = await input.load()
  } catch (error) {
    context.result.notes.push({ ...base, outcome: 'failed', record: match, reason: error instanceof Error ? error.message : String(error) })
    return
  }
  if (content === 'pending') {
    context.result.notes.push({ ...base, outcome: 'pending', record: match })
    return
  }
  if (content.trim().length < MIN_CONTENT_CHARS) {
    context.result.notes.push({ ...base, outcome: 'skipped', record: match, reason: 'too_short' })
    await recordImport(context, { ...base, meetingDate: input.meetingDate, record: match, noteId: null, skippedReason: 'too_short' })
    return
  }
  context.budget.remaining -= 1
  context.result.notes.push({ ...base, outcome: 'imported', record: match })
  const landed = await landTranscript(context, {
    provider: input.provider, externalId: input.externalId, record: match, title: input.title,
    meetingDate: input.meetingDate, content, attendees: input.attendees, sourceUrl: input.sourceUrl,
  })
  if (landed.noteId === null) {
    const entry = context.result.notes[context.result.notes.length - 1]
    entry.outcome = landed.reason.startsWith('save_failed') ? 'failed' : 'skipped'
    entry.reason = landed.reason
    // A matter that is not open stays skipped; a failed save is retried next run.
    if (entry.outcome === 'skipped') {
      await recordImport(context, { ...base, meetingDate: input.meetingDate, record: match, noteId: null, skippedReason: landed.reason })
    }
    return
  }
  await recordImport(context, { ...base, meetingDate: input.meetingDate, record: match, noteId: landed.noteId, skippedReason: null })
}

async function sweepGranola(context: SweepContext) {
  const { isGranolaConfigured, listRecentNoteDetails, fetchGranolaNote, GranolaError } = await import('@/lib/granola')
  if (!isGranolaConfigured()) {
    context.result.granola = 'not_configured'
    return
  }
  let notes
  try {
    notes = await listRecentNoteDetails(context.sinceDays)
  } catch (error) {
    context.result.granola = 'failed'
    context.result.errors.push(`Granola list failed: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  context.result.granola = 'swept'
  for (const note of notes) {
    if (context.budget.remaining <= 0) break
    if (context.imported.has(importKey('granola', note.id))) continue
    await processTranscript(context, {
      provider: 'granola',
      externalId: note.id,
      title: note.title,
      meetingDate: (note.startIso ?? note.createdAt).slice(0, 10),
      startIso: note.startIso,
      attendeeEmails: note.attendeeEmails,
      attendees: note.attendeeEmails,
      sourceUrl: note.sourceUrl,
      load: async () => {
        try {
          const document = await fetchGranolaNote(note.id)
          return document.notesMarkdown
        } catch (error) {
          // No AI summary yet: Granola is still processing the meeting.
          if (error instanceof GranolaError && error.status === 409) return 'pending'
          throw error
        }
      },
    })
  }
}

async function sweepTeams(context: SweepContext) {
  const teams = await import('@/lib/microsoftTeams')
  if (!teams.isMicrosoftConfigured()) {
    context.result.teams = 'not_connected'
    return
  }
  const connection = await teams.getMicrosoftConnection(null).catch(() => null)
  if (!connection) {
    context.result.teams = 'not_connected'
    return
  }
  if (!teams.hasTranscriptScope(connection.scopes)) {
    context.result.teams = 'reconnect_needed'
    return
  }

  const { data: appointments, error } = await context.admin.from('appointments')
    .select('id, appointment_type_id, start_time, end_time, attendee_name, attendee_email, second_attendee_email, linked_matter_id, linked_lead_id, online_meeting_url, teams_meeting_id, status')
    .eq('online_meeting_provider', 'microsoft_teams')
    .not('teams_meeting_id', 'is', null)
    .in('status', ['scheduled', 'rescheduled'])
    .gte('end_time', new Date(context.now - context.sinceDays * 86_400_000).toISOString())
    .lte('end_time', new Date(context.now - TEAMS_SETTLE_MS).toISOString())
    .order('end_time', { ascending: false })
  if (error) {
    context.result.teams = 'failed'
    context.result.errors.push(`Could not list Teams appointments: ${error.message}`)
    return
  }
  context.result.teams = 'swept'
  const { listAppointmentTypes } = await import('@/lib/appointments/settings')
  const typeLabels = new Map((await listAppointmentTypes().catch(() => [])).map(type => [type.id, type.label]))

  for (const appointment of appointments ?? []) {
    if (context.budget.remaining <= 0) break
    const meetingId = String(appointment.teams_meeting_id)
    if (context.imported.has(importKey('microsoft_teams', meetingId))) continue
    const attendeeEmails = [appointment.attendee_email, appointment.second_attendee_email]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const typeLabel = typeLabels.get(String(appointment.appointment_type_id)) ?? 'Meeting'
    const attendeeName = typeof appointment.attendee_name === 'string' ? appointment.attendee_name : 'client'
    const knownRecord: Extract<MeetingRecordMatch, { kind: 'matter' | 'lead' }> | null =
      typeof appointment.linked_matter_id === 'string'
        ? { kind: 'matter', id: appointment.linked_matter_id, name: attendeeName, via: 'appointment' }
        : typeof appointment.linked_lead_id === 'string'
          ? { kind: 'lead', id: appointment.linked_lead_id, name: attendeeName, via: 'appointment' }
          : null
    await processTranscript(context, {
      provider: 'microsoft_teams',
      externalId: meetingId,
      title: `${typeLabel} with ${attendeeName} (Teams transcript)`,
      meetingDate: String(appointment.start_time).slice(0, 10),
      startIso: String(appointment.start_time),
      attendeeEmails,
      attendees: attendeeEmailsFrom(attendeeEmails),
      sourceUrl: typeof appointment.online_meeting_url === 'string' ? appointment.online_meeting_url : null,
      knownRecord,
      load: async () => {
        const transcripts = await teams.listTeamsMeetingTranscripts(meetingId)
        // Teams writes the transcript a few minutes after the meeting ends, and
        // never for a meeting nobody recorded; both read as "not yet" within the window.
        if (!transcripts.length) return 'pending'
        const vtt = await teams.fetchTeamsTranscriptVtt(meetingId, transcripts[0].id)
        return vttToTranscriptText(vtt)
      },
    })
  }
}
