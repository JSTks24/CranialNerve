import OpenAI from 'openai'

export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface AiClientConfig {
    baseURL: string
    apiKey: string
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

export default function createAiGateway(): AiGateway {
    return {
        async chatCompletion(messages, clientConfig, params) {
            const client = new OpenAI({
                baseURL: clientConfig.baseURL,
                apiKey: clientConfig.apiKey,
                dangerouslyAllowBrowser: true,
            })
            const requestMessages = messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
            if (params.stream) {
                const stream = await client.chat.completions.create({
                    ...params,
                    stream: true,
                    messages: requestMessages,
                })
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
                ...params,
                messages: requestMessages,
            })
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
