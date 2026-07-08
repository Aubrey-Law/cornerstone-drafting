import { describe, expect, it } from 'vitest'
import { maskSecretHint, sealSecret, openSecret, isSecretBoxConfigured } from '@/lib/secretBox'
import { lettersOnly, splitQuoteSegments } from '@/lib/highlightDocxQuote'
import { columnsFromPreset, defaultEstateColumns } from '@/lib/estateTabularPresets'
import { parseUserPreferences, resolveAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from '@/lib/userPreferences'
import { normalizeApiKeyProvider } from '@/lib/userApiKeys'

describe('secretBox', () => {
  it('masks hints', () => {
    expect(maskSecretHint('sk-abcdefghijklmnop')).toMatch(/••••mnop$/)
  })

  it('round-trips when encryption secret is set', () => {
    process.env.USER_API_KEYS_ENCRYPTION_SECRET = 'test-secret-for-vitest-only'
    expect(isSecretBoxConfigured()).toBe(true)
    const sealed = sealSecret('sk-live-example')
    expect(openSecret(sealed)).toBe('sk-live-example')
  })
})

describe('highlightDocxQuote helpers', () => {
  it('lettersOnly strips punctuation', () => {
    expect(lettersOnly('Hello, World!')).toBe('helloworld')
  })

  it('splits ellipsis segments', () => {
    expect(splitQuoteSegments('alpha … beta').length).toBe(2)
  })
})

describe('estate tabular presets', () => {
  it('builds indexed estate columns', () => {
    const cols = defaultEstateColumns()
    expect(cols.length).toBeGreaterThan(3)
    expect(cols[0]?.index).toBe(0)
    expect(columnsFromPreset('missing').length).toBe(0)
  })
})

describe('user preferences models', () => {
  it('parses anthropic model preference and remaps retired ids', () => {
    const prefs = parseUserPreferences({
      models: { anthropicModel: 'claude-opus-4-20250514' },
    })
    expect(resolveAnthropicModel(prefs)).toBe('claude-opus-4-5')
    expect(resolveAnthropicModel({})).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
  })
})

describe('api key providers', () => {
  it('normalizes claude → anthropic', () => {
    expect(normalizeApiKeyProvider('claude')).toBe('anthropic')
    expect(normalizeApiKeyProvider('openai')).toBe('openai')
    expect(normalizeApiKeyProvider('nope')).toBeNull()
  })
})
