import type { ApiKeySource, ApiKeyProvider } from '@/lib/userApiKeys'

export type LlmProvider = ApiKeyProvider

export interface LlmConfig {
  provider: LlmProvider
  model: string
  apiKey: string
  keySource: ApiKeySource
}

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LlmCompleteRequest {
  system?: string
  messages: LlmMessage[]
  maxTokens?: number
}

export interface LlmCompleteResult {
  text: string
  provider: LlmProvider
  model: string
  keySource: ApiKeySource
}

export interface LlmToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LlmChatHooks {
  onDelta?: (text: string) => void
  onTool?: (event: { phase: 'start' | 'result'; name: string; ok?: boolean }) => void
}

export interface LlmChatRequest {
  system: string
  messages: LlmMessage[]
  maxTokens?: number
  tools?: LlmToolDefinition[]
  executeTool?: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  maxToolRounds?: number
  hooks?: LlmChatHooks
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export interface LlmChatResult {
  reply: string
  provider: LlmProvider
  model: string
  keySource: ApiKeySource
  toolsUsed: Array<{ tool: string; ok: boolean }>
  /** Token usage totals across tool rounds; currently populated by the Anthropic provider only. */
  usage?: LlmUsage
}
