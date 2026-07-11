import Anthropic from '@anthropic-ai/sdk'
import type {
  LlmChatRequest,
  LlmChatResult,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmConfig,
  LlmToolDefinition,
} from '@/lib/llm/types'

function toAnthropicTools(tools: LlmToolDefinition[]): Anthropic.Tool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
  }))
}

export async function completeAnthropic(
  config: LlmConfig,
  request: LlmCompleteRequest,
): Promise<LlmCompleteResult> {
  const client = new Anthropic({ apiKey: config.apiKey })
  const response = await client.messages.create({
    model: config.model,
    max_tokens: request.maxTokens ?? 4096,
    ...(request.system ? { system: request.system } : {}),
    messages: request.messages.map(m => ({ role: m.role, content: m.content })),
  })
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return {
    text,
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
  }
}

export async function chatAnthropic(
  config: LlmConfig,
  request: LlmChatRequest,
): Promise<LlmChatResult> {
  const client = new Anthropic({ apiKey: config.apiKey })
  const tools = request.tools ?? []
  const maxRounds = request.maxToolRounds ?? 4
  const toolsUsed: LlmChatResult['toolsUsed'] = []
  let replyText = ''
  const workingMessages: Anthropic.MessageParam[] = request.messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  for (let round = 0; round < maxRounds; round++) {
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: request.maxTokens ?? 2048,
      system: request.system,
      messages: workingMessages,
      ...(tools.length > 0 ? { tools: toAnthropicTools(tools) } : {}),
    })

    let roundText = ''
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta' &&
        event.delta.text
      ) {
        roundText += event.delta.text
        request.hooks?.onDelta?.(event.delta.text)
      }
    }

    const final = await stream.finalMessage()
    const toolUses = final.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )

    if (final.stop_reason !== 'tool_use' || toolUses.length === 0 || !request.executeTool) {
      const textFromBlocks = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      replyText = roundText || textFromBlocks
      return {
        reply: replyText,
        provider: config.provider,
        model: config.model,
        keySource: config.keySource,
        toolsUsed,
      }
    }

    workingMessages.push({ role: 'assistant', content: final.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const toolUse of toolUses) {
      const input =
        typeof toolUse.input === 'object' && toolUse.input && !Array.isArray(toolUse.input)
          ? (toolUse.input as Record<string, unknown>)
          : {}
      request.hooks?.onTool?.({ phase: 'start', name: toolUse.name })
      const executed = await request.executeTool(toolUse.name, input)
      request.hooks?.onTool?.({ phase: 'result', name: toolUse.name, ok: executed.ok })
      toolsUsed.push({ tool: toolUse.name, ok: executed.ok })
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: executed.ok ? executed.text.slice(0, 12_000) : `Error: ${executed.error}`,
        is_error: !executed.ok,
      })
    }

    workingMessages.push({ role: 'user', content: toolResults })
  }

  return {
    reply: replyText || 'Tool loop limit reached.',
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
    toolsUsed,
  }
}
