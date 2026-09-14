import { describe, expect, it } from 'vitest'
import { maskSecretHint, sealSecret, openSecret, isSecretBoxConfigured } from '@/lib/secretBox'
import { lettersOnly, splitQuoteSegments } from '@/lib/highlightDocxQuote'
import { columnsFromPreset, defaultEstateColumns } from '@/lib/estateTabularPresets'
import {
  parseUserPreferences,
  resolveActiveLlmPreference,
  resolveAnthropicModel,
  resolveGeminiModel,
  resolveLlmProvider,
  resolveModelForProvider,
  resolveOpenAiModel,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_OPENAI_MODEL,
} from '@/lib/userPreferences'
import { normalizeApiKeyProvider } from '@/lib/userApiKeys'
import { estimateUsdCost } from '@/lib/aiUsage'

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
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-opus-4-8')
  })

  it('parses multi-provider model preferences', () => {
    const prefs = parseUserPreferences({
      models: {
        defaultProvider: 'openai',
        anthropicModel: 'claude-haiku-4-5',
        openaiModel: 'gpt-4o',
        geminiModel: 'gemini-2.5-pro',
      },
    })
    expect(resolveLlmProvider(prefs)).toBe('openai')
    expect(resolveOpenAiModel(prefs)).toBe('gpt-4o')
    expect(resolveGeminiModel(prefs)).toBe('gemini-2.5-pro')
    expect(resolveActiveLlmPreference(prefs)).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(resolveModelForProvider('anthropic', prefs)).toBe('claude-haiku-4-5')
  })

  it('defaults provider and models when unset', () => {
    expect(resolveLlmProvider({})).toBe(DEFAULT_LLM_PROVIDER)
    expect(resolveOpenAiModel({})).toBe(DEFAULT_OPENAI_MODEL)
    expect(resolveGeminiModel({})).toBe(DEFAULT_GEMINI_MODEL)
    expect(resolveActiveLlmPreference({})).toEqual({
      provider: 'anthropic',
      model: DEFAULT_ANTHROPIC_MODEL,
    })
  })
})

describe('ai usage cost estimates', () => {
  const oneMillionInOut = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }

  it('prices opus 4.6+ at $5/$25 per MTok', () => {
    expect(estimateUsdCost({ model: 'claude-opus-4-8', ...oneMillionInOut })).toBe(30)
  })

  it('prices sonnet 5 at $3/$15 per MTok', () => {
    expect(estimateUsdCost({ model: 'claude-sonnet-5', ...oneMillionInOut })).toBe(18)
  })

  it('keeps legacy opus 4.5 at $15/$75 per MTok', () => {
    expect(estimateUsdCost({ model: 'claude-opus-4-5', ...oneMillionInOut })).toBe(90)
  })
})

describe('api key providers', () => {
  it('normalizes claude → anthropic', () => {
    expect(normalizeApiKeyProvider('claude')).toBe('anthropic')
    expect(normalizeApiKeyProvider('openai')).toBe('openai')
    expect(normalizeApiKeyProvider('nope')).toBeNull()
  })
})

describe('cost estimates for models this table does not price', () => {
  const oneMillion = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }

  // The add-in and matter assistants resolve a per-user provider, so an OpenAI
  // or Gemini id reaches ai_usage — and used to be priced at the Opus rate.
  it('does not price a non-Anthropic model as Opus', () => {
    expect(estimateUsdCost({ model: 'gpt-4.1', ...oneMillion })).toBe(0)
    expect(estimateUsdCost({ model: 'gemini-2.5-flash', ...oneMillion })).toBe(0)
  })

  it('still prices Anthropic models', () => {
    expect(estimateUsdCost({ model: 'claude-sonnet-5', ...oneMillion })).toBe(18)
  })
})
