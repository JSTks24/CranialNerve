import { getHostContext } from './host-context'

export interface ChatGateway {
    getChat(): SillyTavernChatMessage[]
    getLastUserMessageId(): number | null
    appendKeywordsToMessage(messageId: number, keywords: string[]): void
    readChatMetadata(key: string): unknown
    writeChatMetadata(key: string, value: unknown): void
    readMessageExtra(messageId: number, key: string): unknown
    writeMessageExtra(messageId: number, key: string, value: unknown): void
}

export default function createChatGateway(): ChatGateway {
    return {
        getChat() {
            return getHostContext().chat
        },
        getLastUserMessageId() {
            const chat = getHostContext().chat
            for (let i = chat.length - 1; i >= 0; i--) {
                const msg = chat[i]
                if (msg && msg.is_user) {
                    return i
                }
            }
            return null
        },
        appendKeywordsToMessage(messageId, keywords) {
            const chat = getHostContext().chat
            const msg = chat[messageId]
            if (!msg) {
                throw new Error(`message ${messageId} not found`)
            }
            msg.mes = `${msg.mes}\n${keywords.join(' ')}`
        },
        readChatMetadata(key) {
            return getHostContext().chatMetadata[key]
        },
        writeChatMetadata(key, value) {
            getHostContext().chatMetadata[key] = value
        },
        readMessageExtra(messageId, key) {
            const msg = getHostContext().chat[messageId]
            if (!msg) {
                throw new Error(`message ${messageId} not found`)
            }
            return msg.extra?.[key]
        },
        writeMessageExtra(messageId, key, value) {
            const chat = getHostContext().chat
            const msg = chat[messageId]
            if (!msg) {
                throw new Error(`message ${messageId} not found`)
            }
            if (!msg.extra) {
                msg.extra = {}
            }
            msg.extra[key] = value
        },
    }
}
