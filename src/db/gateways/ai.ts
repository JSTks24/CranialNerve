import { getRequestHeaders } from './host-context'
import { pushLog, isDebugMode } from '@shared/log-buffer'
import { pushPromptTrace, appendTraceResponse } from '@shared/prompt-trace'

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
    responseFormat?: 'none' | 'json_object'
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

export interface AiCallOptions {
    timeoutMs?: number
    timeoutRetries?: number
    scene?: string
}

export interface AiGateway {
    chatCompletion(
        messages: AiChatMessage[],
        clientConfig: AiClientConfig,
        params: ChatCompletionParams,
        signal?: AbortSignal,
        callOptions?: AiCallOptions,
    ): Promise<string>
}

export default function createAiGateway(): AiGateway {
    return {
        async chatCompletion(messages, clientConfig, params, signal, callOptions) {
            const scene = callOptions?.scene ?? 'ai'
            let traceId = 0
            if (isDebugMode()) {
                traceId = pushPromptTrace({
                    scene,
                    model: params.model,
                    segments: messages.map((m) => ({ role: m.role, content: m.content })),
                })
            }
            pushLog('debug', 'ai', `-> ${scene} 已发送 ${messages.length} 段提示词`, traceId)
            const timeoutMs = callOptions?.timeoutMs ?? 0
            const timeoutRetries = Math.max(0, callOptions?.timeoutRetries ?? 0)
            const maxAttempts = timeoutMs > 0 ? timeoutRetries + 1 : 1
            let lastError: unknown = null
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                try {
                    const raw = await doChatCompletion(messages, clientConfig, params, signal, timeoutMs)
                    if (traceId) {
                        appendTraceResponse(traceId, raw)
                        pushLog('debug', 'ai', `<- ${scene} 收到回复 ${raw.length} 字`, traceId)
                    }
                    return raw
                } catch (e) {
                    lastError = e
                    if (signal?.aborted) throw e
                    if (attempt < maxAttempts - 1) {
                        pushLog('warn', 'ai', `AI 调用失败（第 ${attempt + 1}/${maxAttempts} 次，将重试）: ${e instanceof Error ? e.message : String(e)}`)
                        continue
                    }
                }
            }
            throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'AI 调用失败'))
        },
    }
}

async function doChatCompletion(
    messages: AiChatMessage[],
    clientConfig: AiClientConfig,
    params: ChatCompletionParams,
    signal: AbortSignal | undefined,
    timeoutMs: number,
): Promise<string> {
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
    if (clientConfig.responseFormat === 'json_object') {
        body.custom_include_body = JSON.stringify({ response_format: { type: 'json_object' } })
    }

    const headers = getRequestHeaders()
    headers['Content-Type'] = 'application/json'

    const { signal: mergedSignal, cleanup } = mergeAbort(signal, timeoutMs)
    try {
        const res = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: mergedSignal,
        })

        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error((err as { error?: { message?: string } }).error?.message
                ?? (err as { message?: string }).message
                ?? `AI 请求失败：${res.status}`)
        }

        if (stream) {
            return await readStream(res, mergedSignal)
        }

        const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>
        }
        if (!json.choices?.[0]) {
            throw new Error('AI response has no choices')
        }
        const content = json.choices[0].message?.content
        if (content === undefined || content === null) {
            throw new Error('AI response has no content')
        }
        return content
    } finally {
        cleanup()
    }
}

function mergeAbort(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(new DOMException('AI call timeout', 'AbortError')), timeoutMs)
    }
    if (signal) {
        if (signal.aborted) {
            controller.abort(signal.reason)
        } else {
            signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
        }
    }
    return { signal: controller.signal, cleanup: () => { if (timer) clearTimeout(timer) } }
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

async function readStream(res: Response, signal: AbortSignal): Promise<string> {
    if (!res.body) {
        throw new Error('stream response has no body')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let content = ''
    let pending = ''
    try {
        while (true) {
            if (signal.aborted) {
                try { await reader.cancel() } catch {}
                throw new DOMException('Aborted', 'AbortError')
            }
            const { done, value } = await reader.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            const lines = pending.split('\n')
            pending = lines.pop() ?? ''
            for (const line of lines) {
                const delta = parseSseLine(line)
                if (delta) content += delta
            }
        }
        if (pending.trim().length > 0) {
            const delta = parseSseLine(pending)
            if (delta) content += delta
        }
    } finally {
        try { reader.releaseLock() } catch {}
    }
    return content
}

function parseSseLine(line: string): string | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    const m = trimmed.match(/^data:\s?(.*)$/)
    if (!m) return null
    const payload = m[1]!.trim()
    if (payload === '[DONE]') return null
    try {
        const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = chunk.choices?.[0]?.delta?.content
        return delta ?? null
    } catch (e) {
        pushLog('warn', 'ai', `SSE chunk 解析失败: ${e instanceof Error ? e.message : String(e)}`)
        return null
    }
}
