import { describe, expect, it } from 'vitest'
import { llmKeyMissingMessage } from '@/lib/llm/resolve'
import { LLM_PROVIDER_LABELS } from '@/lib/userPreferences'

describe('lib/llm resolve', () => {
  it('formats missing key messages per provider', () => {
    expect(llmKeyMissingMessage('anthropic')).toContain(LLM_PROVIDER_LABELS.anthropic)
    expect(llmKeyMissingMessage('anthropic')).toContain('ANTHROPIC_API_KEY')
    expect(llmKeyMissingMessage('openai')).toContain('OPENAI_API_KEY')
    expect(llmKeyMissingMessage('gemini')).toContain('GEMINI_API_KEY')
  })
})
