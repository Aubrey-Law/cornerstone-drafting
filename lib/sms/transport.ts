const SMS_EXTENSION_PATTERN = /\b(?:ext\.?|extension|x)\s*[0-9][0-9 .-]*$/i

export interface SmsSendInput {
  to: string
  body: string
}
export interface SmsSendSuccess {
  ok: true
  providerMessageId: string
  status: string
  to: string
}

export interface SmsSendFailure {
  ok: false
  error: string
}

export type SmsSendResult = SmsSendSuccess | SmsSendFailure

export function normalizeSmsRecipient(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || SMS_EXTENSION_PATTERN.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
