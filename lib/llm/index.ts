import { chatAnthropic, completeAnthropic } from '@/lib/llm/providers/anthropic'
import { chatGemini, completeGemini } from '@/lib/llm/providers/gemini'
import { chatOpenAi, completeOpenAi } from '@/lib/llm/providers/openai'
import type { LlmChatRequest, LlmChatResult, LlmCompleteRequest, LlmCompleteResult, LlmConfig } from '@/lib/llm/types'

export type {
  LlmChatRequest,
  LlmChatResult,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmConfig,
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
} from '@/lib/llm/types'

export { llmKeyMissingMessage, resolveLlmConfig } from '@/lib/llm/resolve'

export async function completeLlmText(
  config: LlmConfig,
  request: LlmCompleteRequest,
): Promise<LlmCompleteResult> {
  switch (config.provider) {
    case 'anthropic':
      return completeAnthropic(config, request)
    case 'openai':
      return completeOpenAi(config, request)
    case 'gemini':
      return completeGemini(config, request)
  }
}

export async function runLlmChat(
  config: LlmConfig,
  request: LlmChatRequest,
): Promise<LlmChatResult> {
  switch (config.provider) {
    case 'anthropic':
      return chatAnthropic(config, request)
    case 'openai':
      return chatOpenAi(config, request)
    case 'gemini':
      return chatGemini(config, request)
  }
}
