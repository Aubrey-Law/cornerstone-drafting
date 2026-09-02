type Phoneish = string | null | undefined

const EXTENSION_PATTERN = /\b(?:ext\.?|extension|x)\s*([0-9][0-9 .-]*)\s*$/i

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function extractExtension(value: string): { numberText: string; extensionText: string } {
  const match = value.match(EXTENSION_PATTERN)
  if (!match || match.index === undefined) {
    return { numberText: value, extensionText: '' }
  }

  const marker = match[0].slice(0, match[0].search(/[0-9]/)).trim().toLowerCase()
  const extensionDigits = digitsOnly(match[1] ?? '')
  const extensionText = marker.startsWith('x')
    ? `x${extensionDigits}`
    : `ext. ${extensionDigits}`

  return {
    numberText: value.slice(0, match.index).trim(),
    extensionText,
  }
}

function usPhoneDigits(value: string): string {
  const digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.slice(0, 10)
}

function formatDigits(digits: string): string {
  if (!digits) return ''
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}

export function formatPhoneInput(value: Phoneish): string {
  if (!value) return ''

  const { numberText } = extractExtension(value.trim())
  return formatDigits(usPhoneDigits(numberText))
}

export function formatPhoneDisplay(value: Phoneish): string {
  if (!value) return ''

  const trimmed = value.trim()
  if (!trimmed) return ''

  const { numberText, extensionText } = extractExtension(trimmed)
  const digits = usPhoneDigits(numberText)
  if (digits.length !== 10) return trimmed

  const formatted = formatDigits(digits)
  return extensionText ? `${formatted} ${extensionText}` : formatted
}

export function formatPhoneForStorage(value: Phoneish): string | null {
  const formatted = formatPhoneDisplay(value)
  return formatted || null
}

export function phoneTelHref(value: Phoneish): string | null {
  if (!value) return null

  const { numberText } = extractExtension(value.trim())
  const digits = usPhoneDigits(numberText)
  if (digits.length !== 10) return null

  return `tel:+1${digits}`
}

function isPhoneKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized === 'phone'
    || normalized.endsWith('_phone')
    || normalized === 'contactphone'
}

export function formatPhoneFieldsDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => formatPhoneFieldsDeep(item)) as T
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isPhoneKey(key) && typeof item === 'string') {
      next[key] = formatPhoneForStorage(item)
    } else {
      next[key] = formatPhoneFieldsDeep(item)
    }
  }

  return next as T
}
