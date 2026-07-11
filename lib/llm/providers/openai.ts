import OpenAI from 'openai'
import type {
  LlmChatRequest,
  LlmChatResult,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmConfig,
  LlmMessage,
  LlmToolDefinition,
} from '@/lib/llm/types'

type OpenAiMessage =
  | OpenAI.Chat.Completions.ChatCompletionMessageParam
  | OpenAI.Chat.Completions.ChatCompletionToolMessageParam
  | OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam

function toOpenAiMessages(system: string | undefined, messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function toOpenAiTools(tools: LlmToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}

export async function completeOpenAi(
  config: LlmConfig,
  request: LlmCompleteRequest,
): Promise<LlmCompleteResult> {
  const client = new OpenAI({ apiKey: config.apiKey })
  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: request.maxTokens ?? 4096,
    messages: toOpenAiMessages(request.system, request.messages),
  })
  const text = response.choices[0]?.message?.content ?? ''
  return {
    text: typeof text === 'string' ? text : '',
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
  }
}

export async function chatOpenAi(
  config: LlmConfig,
  request: LlmChatRequest,
): Promise<LlmChatResult> {
  const client = new OpenAI({ apiKey: config.apiKey })
  const tools = request.tools ?? []
  const maxRounds = request.maxToolRounds ?? 4
  const toolsUsed: LlmChatResult['toolsUsed'] = []
  const workingMessages = toOpenAiMessages(request.system, request.messages)

  for (let round = 0; round < maxRounds; round++) {
    const stream = await client.chat.completions.create({
      model: config.model,
      max_tokens: request.maxTokens ?? 2048,
      messages: workingMessages,
      ...(tools.length > 0 ? { tools: toOpenAiTools(tools), tool_choice: 'auto' as const } : {}),
      stream: true,
    })

    let roundText = ''
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      const delta = choice?.delta
      if (delta?.content) {
        roundText += delta.content
        request.hooks?.onDelta?.(delta.content)
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          const existing = toolCalls.get(idx) ?? { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
          toolCalls.set(idx, existing)
        }
      }
    }

    const calls = [...toolCalls.values()].filter(c => c.name)
    if (calls.length === 0 || !request.executeTool) {
      return {
        reply: roundText,
        provider: config.provider,
        model: config.model,
        keySource: config.keySource,
        toolsUsed,
      }
    }

    workingMessages.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: calls.map(c => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments || '{}' },
      })),
    })

    for (const call of calls) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(call.arguments || '{}') as Record<string, unknown>
      } catch {
        input = {}
      }
      request.hooks?.onTool?.({ phase: 'start', name: call.name })
      const executed = await request.executeTool(call.name, input)
      request.hooks?.onTool?.({ phase: 'result', name: call.name, ok: executed.ok })
      toolsUsed.push({ tool: call.name, ok: executed.ok })
      workingMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: executed.ok ? executed.text.slice(0, 12_000) : `Error: ${executed.error}`,
      })
    }
  }

  return {
    reply: 'Tool loop limit reached.',
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
    toolsUsed,
  }
}
