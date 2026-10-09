import { portalUrl } from '@/lib/urls'
import type { OnlineMeetingProvider } from './calendarTypes'
import { formatWhen } from './emailFormat'
import type { AppointmentType } from './types'
import { firmOfficeAddress } from './officeAddress'

/**
 * The client-facing confirmation, built the same way whether it is sent from
 * the booking call or by the delegation dial's `appointment.confirmation.send`
 * action later. One builder, so the preview a person approves is the email
 * the client receives. Works for every appointment type: label, time, and
 * format/location all come from the input.
 */

export type ConfirmationEvent = 'booked' | 'rescheduled'

export interface ConfirmationEmailInput {
  type: Pick<AppointmentType, 'label' | 'locationType'>
  startIso: string
  timezone: string
  officeAddress: string | null
  meetingUrl: string | null
  meetingProvider: OnlineMeetingProvider | null
  /** The raw manage-link token; null leaves the reschedule/cancel button out. */
  manageToken: string | null
  event: ConfirmationEvent
  /** Optional — personalizes the headline ("You're all set, Margaret."). */
  firstName?: string | null
}

const FIRM = {
  name: 'Aubrey Law',
  tagline: 'Your Legacy. Carefully Planned.',
  address: '1329 Highland Ave, Needham, MA 02492',
  phone: '(781) 474-3450',
  phoneHref: 'tel:+17814743450',
  site: 'https://aubreylegal.com',
}
const C = { navy: '#1F2D5A', teal: '#1A6B72', tealInk: '#14444A', tealBg: '#E2EFEF', ink: '#111827', muted: '#4D5763', rule: '#E3E8F0', border: '#C9D3E0', page: '#EDF1F7' }
const SANS = 'Arial,Helvetica,sans-serif'
const SERIF = "Georgia,'Times New Roman',serif"

function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function splitWhen(startIso: string, timezone: string): { date: string; time: string } {
  const d = new Date(startIso)
  try {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d)
    return { date, time }
  } catch {
    return { date: startIso, time: '' }
  }
}

function link(href: string, text: string): string {
  return '<a href="' + esc(href) + '" style="color:' + C.teal + ';text-decoration:underline;">' + esc(text) + '</a>'
}

function locationRows(input: ConfirmationEmailInput): [string, string][] {
  const url = input.meetingUrl
  if (input.meetingProvider === 'microsoft_teams' && url) {
    return [['Format', 'Video call — Microsoft Teams'], ['Join', link(url, 'Join the meeting')]]
  }
  switch (input.type.locationType) {
    case 'teams':
      return url
        ? [['Format', 'Video call — Google Meet'], ['Join', link(url, 'Join the meeting')]]
        : [['Format', 'Video call'], ['Join', 'The meeting link is in your calendar invitation']]
    case 'in_person':
      return [['Format', 'In person'], ['Where', esc(input.officeAddress || FIRM.address)]]
    default:
      return [['Format', 'Phone call'], ['Details', 'We will call the number you provided']]
  }
}

function row(label: string, value: string, last: boolean): string {
  const bd = last ? '' : 'border-bottom:1px solid ' + C.rule + ';'
  return '<tr>'
    + '<td width="110" valign="top" style="padding:12px 0;' + bd + 'font-family:' + SANS + ';font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:' + C.muted + ';line-height:22px;">' + label + '</td>'
    + '<td valign="top" style="padding:12px 0;' + bd + 'font-family:' + SANS + ';font-size:16px;color:' + C.ink + ';line-height:22px;">' + value + '</td>'
    + '</tr>'
}

export function buildAppointmentConfirmationEmail(input: ConfirmationEmailInput): { subject: string; html: string; when: string } {
  const when = formatWhen(input.startIso, input.timezone)
  const { date, time } = splitWhen(input.startIso, input.timezone)
  const rescheduled = input.event === 'rescheduled'
  const verb = rescheduled ? 'rescheduled' : 'confirmed'
  const label = esc(input.type.label)
  const name = input.firstName ? ', ' + esc(input.firstName) : ''
  const headline = rescheduled ? 'Your new time is set' + name + '.' : "You're all set" + name + '.'
  const intro = rescheduled
    ? 'Your ' + label + ' with ' + FIRM.name + ' has moved to the time below. Your previous time has been released.'
    : 'Thank you for scheduling your ' + label + ' with ' + FIRM.name + '. The details are below.'
  const rows = locationRows(input)
  const manageUrl = input.manageToken ? portalUrl('/book/manage/' + input.manageToken) : null
  const preheader = label + ' ' + verb + ': ' + date + (time ? ' at ' + time : '') + '.'

  const button = manageUrl
    ? '<tr><td style="padding:24px 48px 0 48px;" class="px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
      + '<td align="center" style="border:1px solid ' + C.navy + ';border-radius:8px;">'
      + '<a href="' + esc(manageUrl) + '" style="display:block;padding:13px 28px;font-family:' + SANS + ';font-size:16px;font-weight:bold;color:' + C.navy + ';text-decoration:none;line-height:20px;">Reschedule or cancel</a>'
      + '</td></tr></table></td></tr>'
    : ''

  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>' + label + ' ' + verb + '</title>'
    + '<style>@media only screen and (max-width:620px){.wrap{width:100% !important;}.px{padding-left:24px !important;padding-right:24px !important;}}</style></head>'
    + '<body style="margin:0;padding:0;background:' + C.page + ';">'
    + '<span style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:' + C.page + ';">' + preheader + ' A calendar invitation is on its way.</span>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.page + ';"><tr><td align="center" style="padding:40px 12px;">'
    + '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->'
    + '<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">'
    + '<tr><td align="center" style="padding:0 0 24px 0;">'
    + '<div style="font-family:' + SERIF + ';font-size:24px;letter-spacing:5px;color:' + C.navy + ';line-height:28px;mso-line-height-rule:exactly;">AUBREY&nbsp;LAW</div>'
    + '<div style="font-family:' + SERIF + ';font-style:italic;font-size:13px;color:' + C.navy + ';line-height:20px;mso-line-height-rule:exactly;">' + FIRM.tagline + '</div>'
    + '</td></tr>'
    + '<tr><td style="background:#FFFFFF;border:1px solid ' + C.border + ';border-radius:14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td height="4" style="background:' + C.teal + ';border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '<tr><td class="px" style="padding:40px 48px 0 48px;">'
    + '<div style="font-family:' + SANS + ';font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:' + C.teal + ';line-height:16px;">Appointment ' + verb + '</div>'
    + '<h1 style="margin:10px 0 0 0;font-family:' + SERIF + ';font-size:30px;font-weight:normal;color:' + C.navy + ';line-height:38px;mso-line-height-rule:exactly;">' + headline + '</h1>'
    + '<p style="margin:14px 0 0 0;font-family:' + SANS + ';font-size:16px;color:' + C.muted + ';line-height:25px;">' + intro + '</p>'
    + '</td></tr>'
    + '<tr><td class="px" style="padding:28px 48px 0 48px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="background:' + C.tealBg + ';border:1px solid ' + C.teal + ';border-radius:10px;padding:22px 24px;">'
    + '<div style="font-family:' + SANS + ';font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:' + C.tealInk + ';line-height:16px;">' + label + '</div>'
    + '<div style="margin-top:8px;font-family:' + SERIF + ';font-size:24px;color:' + C.tealInk + ';line-height:30px;mso-line-height-rule:exactly;">' + esc(date) + '</div>'
    + (time ? '<div style="margin-top:2px;font-family:' + SANS + ';font-size:17px;color:' + C.tealInk + ';line-height:24px;">' + esc(time) + '</div>' : '')
    + '</td></tr></table></td></tr>'
    + '<tr><td class="px" style="padding:20px 48px 0 48px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + rows.map((r, i: number) => row(r[0], r[1], i === rows.length - 1)).join('')
    + '</table></td></tr>'
    + button
    + '<tr><td class="px" style="padding:28px 48px 40px 48px;"><p style="margin:0;font-family:' + SANS + ';font-size:15px;color:' + C.muted + ';line-height:23px;">A calendar invitation is on its way to your inbox. Questions? Reply to this email or call ' + '<a href="' + FIRM.phoneHref + '" style="color:' + C.teal + ';text-decoration:none;">' + FIRM.phone + '</a>.</p></td></tr>'
    + '</table></td></tr>'
    + '<tr><td align="center" style="padding:28px 24px 0 24px;">'
    + '<p style="margin:0;font-family:' + SANS + ';font-size:13px;color:' + C.muted + ';line-height:20px;">' + FIRM.name + ' · ' + FIRM.address.replace(', Needham', ' · Needham') + '<br>'
    + '<a href="' + FIRM.phoneHref + '" style="color:' + C.teal + ';text-decoration:none;">' + FIRM.phone + '</a> · <a href="' + FIRM.site + '" style="color:' + C.teal + ';text-decoration:none;">aubreylegal.com</a></p>'
    + '<p style="margin:12px 0 0 0;font-family:' + SANS + ';font-size:12px;color:' + C.muted + ';line-height:18px;">You are receiving this because an appointment was booked with ' + FIRM.name + '. This email does not create an attorney–client relationship.</p>'
    + '</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>'

  return { when, subject: 'Appointment ' + verb + ': ' + input.type.label + ' — ' + when, html }
}

/** Office line for the location sentence, from firm settings. */
export function officeAddressLine(firm: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string | null {
  // One office address for every surface; see lib/appointments/officeAddress.ts.
  return firmOfficeAddress(firm)
}

/** First word of the attendee's name, for the headline; null when there is none. */
export function attendeeFirstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null
}
