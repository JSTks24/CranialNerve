import OpenAI from 'openai'

export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface AiClientConfig {
    baseURL: string
    apiKey: string
    customIncludeBody?: string
    customExcludeBody?: string
    customIncludeHeaders?: string
}

export type ChatCompletionParams = Partial<
    Omit<
        OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        'model' | 'messages'
    >
> & {
    model: string
    stream?: boolean
}

export interface AiGateway {
    chatCompletion(
        messages: AiChatMessage[],
        clientConfig: AiClientConfig,
        params: ChatCompletionParams,
    ): Promise<string>
}

function parseHeaders(raw?: string): Record<string, string> | undefined {
    if (!raw || raw.trim().length === 0) return undefined
    const headers: Record<string, string> = {}
    for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const idx = trimmed.indexOf(':')
        if (idx <= 0) continue
        headers[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
    }
    return Object.keys(headers).length > 0 ? headers : undefined
}

export default function createAiGateway(): AiGateway {
    return {
        async chatCompletion(messages, clientConfig, params) {
            const extraHeaders = parseHeaders(clientConfig.customIncludeHeaders)
            const client = new OpenAI({
                baseURL: clientConfig.baseURL,
                apiKey: clientConfig.apiKey,
                dangerouslyAllowBrowser: true,
                defaultHeaders: extraHeaders,
            })
            const requestMessages = messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]

            let extraBody: Record<string, unknown> = {}
            const bodyParams = { ...params } as Record<string, unknown>
            if (clientConfig.customIncludeBody) {
                try {
                    extraBody = JSON.parse(clientConfig.customIncludeBody) as Record<string, unknown>
                } catch {
                    console.warn('[CranialNerve] customIncludeBody JSON 解析失败，已忽略')
                }
            }
            const excludeKeys = (clientConfig.customExcludeBody ?? '').split('\n').map((k) => k.trim()).filter((k) => k.length > 0)
            const merged = { ...bodyParams, ...extraBody }
            for (const key of excludeKeys) {
                delete merged[key]
            }

            if (params.stream) {
                const stream = await client.chat.completions.create({
                    ...merged,
                    stream: true,
                    messages: requestMessages,
                } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)
                let content = ''
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta?.content
                    if (delta) {
                        content += delta
                    }
                }
                if (!content) {
                    throw new Error('AI stream response has no content')
                }
                return content
            }
            const res = await client.chat.completions.create({
                ...merged,
                messages: requestMessages,
            } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
            if (!('choices' in res) || !res.choices[0]) {
                throw new Error('AI response has no choices')
            }
            const content = res.choices[0].message.content
            if (!content) {
                throw new Error('AI response has no content')
            }
            return content
        },
    }
}
