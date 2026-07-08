import type {
  LlmChatRequest,
  LlmChatResult,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmConfig,
  LlmMessage,
  LlmToolDefinition,
} from '@/lib/llm/types'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: { content: string } }
}

interface GeminiContent {
  role?: string
  parts: GeminiPart[]
}

function toGeminiRole(role: LlmMessage['role']): string {
  return role === 'assistant' ? 'model' : 'user'
}

function buildGeminiContents(
  system: string | undefined,
  messages: LlmMessage[],
): GeminiContent[] {
  const contents: GeminiContent[] = []
  if (system) {
    contents.push({ role: 'user', parts: [{ text: `System instructions:\n${system}` }] })
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] })
  }
  for (const m of messages) {
    contents.push({ role: toGeminiRole(m.role), parts: [{ text: m.content }] })
  }
  return contents
}

function toGeminiTools(tools: LlmToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      })),
    },
  ]
}

async function geminiGenerate(args: {
  apiKey: string
  model: string
  contents: GeminiContent[]
  tools?: LlmToolDefinition[]
  maxTokens?: number
}): Promise<GeminiContent[]> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: args.contents,
      ...(args.tools?.length ? { tools: toGeminiTools(args.tools) } : {}),
      generationConfig: { maxOutputTokens: args.maxTokens ?? 4096 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Gemini HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: GeminiContent }>
  }
  const content = data.candidates?.[0]?.content
  if (!content) throw new Error('Gemini returned no content')
  return [content]
}

function textFromGeminiContent(content: GeminiContent): string {
  return (content.parts ?? [])
    .map(p => p.text ?? '')
    .join('')
    .trim()
}

function functionCallsFromGeminiContent(content: GeminiContent): Array<{ name: string; args: Record<string, unknown> }> {
  return (content.parts ?? [])
    .filter(p => p.functionCall?.name)
    .map(p => ({
      name: p.functionCall!.name,
      args: p.functionCall!.args ?? {},
    }))
}

export async function completeGemini(
  config: LlmConfig,
  request: LlmCompleteRequest,
): Promise<LlmCompleteResult> {
  const contents = buildGeminiContents(request.system, request.messages)
  const [response] = await geminiGenerate({
    apiKey: config.apiKey,
    model: config.model,
    contents,
    maxTokens: request.maxTokens,
  })
  return {
    text: textFromGeminiContent(response),
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
  }
}

export async function chatGemini(
  config: LlmConfig,
  request: LlmChatRequest,
): Promise<LlmChatResult> {
  const tools = request.tools ?? []
  const maxRounds = request.maxToolRounds ?? 4
  const toolsUsed: LlmChatResult['toolsUsed'] = []
  let contents = buildGeminiContents(request.system, request.messages)

  for (let round = 0; round < maxRounds; round++) {
    const [response] = await geminiGenerate({
      apiKey: config.apiKey,
      model: config.model,
      contents,
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: request.maxTokens,
    })

    const text = textFromGeminiContent(response)
    if (text) request.hooks?.onDelta?.(text)

    const calls = functionCallsFromGeminiContent(response)
    if (calls.length === 0 || !request.executeTool) {
      return {
        reply: text,
        provider: config.provider,
        model: config.model,
        keySource: config.keySource,
        toolsUsed,
      }
    }

    contents.push(response)
    const responseParts: GeminiPart[] = []

    for (const call of calls) {
      request.hooks?.onTool?.({ phase: 'start', name: call.name })
      const executed = await request.executeTool(call.name, call.args)
      request.hooks?.onTool?.({ phase: 'result', name: call.name, ok: executed.ok })
      toolsUsed.push({ tool: call.name, ok: executed.ok })
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: {
            content: executed.ok ? executed.text.slice(0, 12_000) : `Error: ${executed.error}`,
          },
        },
      })
    }

    contents.push({ role: 'user', parts: responseParts })
  }

  return {
    reply: 'Tool loop limit reached.',
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
    toolsUsed,
  }
}
