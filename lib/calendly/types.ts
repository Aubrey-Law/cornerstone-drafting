export const CALENDLY_EVENTS = ['invitee.created', 'invitee.canceled'] as const

export type CalendlyEvent = (typeof CALENDLY_EVENTS)[number]

export interface CalendlyScheduledEvent {
  uri?: string
  name?: string
  status?: string
  start_time?: string
  end_time?: string
  /** URI like https://api.calendly.com/event_types/<uuid> */
  event_type?: string
}

export interface CalendlyQuestionAnswer {
  question?: string
  answer?: string
}

export interface CalendlyTracking {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  salesforce_uuid?: string | null
}

export interface CalendlyWebhookPayload {
  /** Invitee URI like https://api.calendly.com/scheduled_events/<ev>/invitees/<uuid> */
  uri?: string
  email?: string
  name?: string
  status?: string
  text_reminder_number?: string | null
  rescheduled?: boolean
  old_invitee?: string | null
  new_invitee?: string | null
  cancel_url?: string
  reschedule_url?: string
  scheduled_event?: CalendlyScheduledEvent
  questions_and_answers?: CalendlyQuestionAnswer[]
  tracking?: CalendlyTracking
}

export interface CalendlyWebhookBody {
  event: string
  created_at?: string
  payload?: CalendlyWebhookPayload
}
