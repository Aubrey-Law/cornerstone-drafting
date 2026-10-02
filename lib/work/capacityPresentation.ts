function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/** Keeps the capacity summary honest when an external calendar read is degraded. */
export function capacityAvailabilityLabel(input: {
  capacityMinutes: number
  interruptionBufferPercent: number
  calendarUnavailable: boolean
}) {
  const capacity = formatDuration(input.capacityMinutes)
  return input.calendarUnavailable
    ? `${capacity} from recorded appointments after ${input.interruptionBufferPercent}% buffer`
    : `${capacity} available after ${input.interruptionBufferPercent}% buffer`
}
