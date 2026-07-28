import { getRequestHeaders } from './host-context'
import { pushLog } from '@shared/log-buffer'

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

export interface ChatCompletionParams {
    model: string
    stream?: boolean
    max_tokens?: number
    temperature?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    seed?: number
    stop?: string[]
    [key: string]: unknown
}

export interface AiGateway {
    chatCompletion(
        messages: AiChatMessage[],
        clientConfig: AiClientConfig,
        params: ChatCompletionParams,
        signal?: AbortSignal,
    ): Promise<string>
}

export default function createAiGateway(): AiGateway {
    return {
        async chatCompletion(messages, clientConfig, params, signal) {
            const { stream, model, ...extraParams } = params
            const body: Record<string, unknown> = {
                chat_completion_source: 'custom',
                custom_url: clientConfig.baseURL,
                custom_include_headers: buildCustomHeaders(clientConfig),
                messages,
                model,
                stream: !!stream,
                ...extraParams,
            }
            if (clientConfig.customIncludeBody) {
                try {
                    const extra = JSON.parse(clientConfig.customIncludeBody)
                    Object.assign(body, extra)
                } catch {
                    pushLog('warn', 'ai', 'customIncludeBody JSON 解析失败，已忽略')
                }
            }
            if (clientConfig.customExcludeBody) {
                body.custom_exclude_body = clientConfig.customExcludeBody
            }

            const headers = getRequestHeaders()
            headers['Content-Type'] = 'application/json'

            const res = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal,
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error((err as { error?: { message?: string } }).error?.message
                    ?? (err as { message?: string }).message
                    ?? `AI 请求失败：${res.status}`)
            }

            if (stream) {
                return readStream(res, signal)
            }

            const json = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>
            }
            if (!json.choices?.[0]) {
                throw new Error('AI response has no choices')
            }
            const content = json.choices[0].message?.content
            if (!content) {
                throw new Error('AI response has no content')
            }
            return content
        },
    }
}

function buildCustomHeaders(config: AiClientConfig): string {
    const lines: string[] = []
    if (config.apiKey) {
        lines.push(`Authorization: Bearer ${config.apiKey}`)
    }
    if (config.customIncludeHeaders) {
        lines.push(config.customIncludeHeaders)
    }
    return lines.join('\n')
}

async function readStream(res: Response, signal?: AbortSignal): Promise<string> {
    if (!res.body) {
        throw new Error('stream response has no body')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let content = ''
    while (true) {
        if (signal?.aborted) {
            try {
                await reader.cancel()
            } catch {}
            throw new DOMException('Aborted', 'AbortError')
        }
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const payload = trimmed.slice(6)
            if (payload === '[DONE]') continue
            try {
                const chunk = JSON.parse(payload) as {
                    choices?: Array<{ delta?: { content?: string } }>
                }
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) content += delta
            } catch {}
        }
    }
    if (!content) {
        throw new Error('AI stream response has no content')
    }
    return content
}
