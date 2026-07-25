function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function documentDisplayTitle(filename: string, clientName?: string | null): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, '')
  let title = withoutExtension.replace(/^\d{4}-\d{2}-\d{2}[\s_-]*/, '')
  const normalizedClient = clientName?.trim().replace(/\s+/g, '[\\s_-]+')
  if (normalizedClient) {
    const clientPattern = clientName!
      .trim()
      .split(/\s+/)
      .map(escapeRegExp)
      .join('[\\s_-]+')
    title = title.replace(new RegExp(`^${clientPattern}[\\s_-]+`, 'i'), '')
  }
  return title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || withoutExtension
}
