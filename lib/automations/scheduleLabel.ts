const WEEKDAYS = '1-5'
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function clock(hour: number, minute: number): string {
  const h = hour % 12 || 12
  const suffix = hour < 12 ? 'AM' : 'PM'
  return `${h}:${String(minute).padStart(2, '0')} ${suffix}`
}

function dayPhrase(dow: string): string | null {
  if (dow === '*' ) return null
  if (dow === WEEKDAYS) return 'Weekdays'
  if (/^\d$/.test(dow)) {
    const day = Number(dow)
    return DAY_NAME[day === 7 ? 0 : day] ?? null
  }
  return null
}

/** One five-field cron, or null when the expression is not one this firm uses. */
function describeOne(cron: string): string | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dow] = fields
  if (dayOfMonth !== '*' || month !== '*') return null
  const days = dayPhrase(dow)

  if (minute === '*' && hour === '*' && !days) return 'Every minute'
  if (minute.startsWith('*/') && hour === '*' && !days) {
    const step = Number(minute.slice(2))
    if (!Number.isInteger(step) || step <= 0) return null
    return step === 1 ? 'Every minute' : `Every ${step} minutes`
  }
  if (minute === '0' && hour === '*' && !days) return 'Every hour'
  if (minute === '0' && hour === '*' && days) return `Every hour on ${days}`
  if (/^\d+$/.test(minute) && hour === '*' && !days) {
    return `${Number(minute)} minutes past every hour`
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const time = clock(Number(hour), Number(minute))
    if (days === 'Weekdays') return `Weekdays at ${time}`
    if (days) return `${days}s at ${time}`
    return `Daily at ${time}`
  }
  return null
}

/**
 * A schedule an attorney can read. Unrecognized cron stays null so the raw
 * expression can remain in the technical disclosure.
 */
export function describeAutomationSchedule(cron: string | null | undefined, timeZone = 'UTC'): string | null {
  if (!cron?.trim()) return null
  const parts = cron.split(',').map(part => describeOne(part.trim()))
  if (parts.some(part => part === null)) return null
  const zone = timeZone?.trim() || 'UTC'
  const phrase = (parts as string[]).join(' and ')
  const timed = parts.some(part => part?.includes(' at '))
  return timed ? `${phrase} ${zone}` : phrase
}
