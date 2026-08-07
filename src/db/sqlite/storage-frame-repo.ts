import type { ChatGateway } from '@db/gateways/chat'
import type { StorageFrame } from '@shared/types/storage-frame'
import { FRAME_FIELD_PREFIX } from '@shared/constants/msg-fields'

export interface FrameRepo {
	loadFrame(messageId: number): StorageFrame | null
	saveFrame(messageId: number, frame: StorageFrame): void
	removeFrame(messageId: number): void
	removeAllFrames(): void
	findLatestFrameMessageId(): number | null
	listFrameMessageIds(): number[]
	countFrames(): number
	findCorruptFrameIds(): number[]
}

export default function createFrameRepo(chat: ChatGateway): FrameRepo {
	return {
		loadFrame(messageId) {
			const raw = chat.readMessageExtra(messageId, FRAME_FIELD_PREFIX)
			if (typeof raw !== 'string' || raw.length === 0) return null
			try {
				return JSON.parse(raw) as StorageFrame
			} catch {
				return null
			}
		},
		saveFrame(messageId, frame) {
			chat.writeMessageExtra(messageId, FRAME_FIELD_PREFIX, JSON.stringify(frame))
		},
		removeFrame(messageId) {
			const msg = chat.getChat()[messageId]
			if (msg?.extra && FRAME_FIELD_PREFIX in msg.extra) {
				delete msg.extra[FRAME_FIELD_PREFIX]
			}
		},
		removeAllFrames() {
			const messages = chat.getChat()
			for (let i = 0; i < messages.length; i++) {
				const extra = messages[i]?.extra
				if (extra && FRAME_FIELD_PREFIX in extra) {
					delete extra[FRAME_FIELD_PREFIX]
				}
			}
		},
		findLatestFrameMessageId() {
			const messages = chat.getChat()
			for (let i = messages.length - 1; i >= 0; i--) {
				const extra = messages[i]?.extra
				if (extra && typeof extra[FRAME_FIELD_PREFIX] === 'string') {
					return i
				}
			}
			return null
		},
		listFrameMessageIds() {
			const messages = chat.getChat()
			const out: number[] = []
			for (let i = messages.length - 1; i >= 0; i--) {
				const extra = messages[i]?.extra
				if (extra && typeof extra[FRAME_FIELD_PREFIX] === 'string') {
					out.push(i)
				}
			}
			return out
		},
		countFrames() {
			return this.listFrameMessageIds().length
		},
		findCorruptFrameIds() {
			const messages = chat.getChat()
			const out: number[] = []
			for (let i = 0; i < messages.length; i++) {
				const extra = messages[i]?.extra
				if (!extra || typeof extra !== 'object') continue
				for (const key of Object.keys(extra)) {
					if (!key.startsWith(FRAME_FIELD_PREFIX)) continue
					const raw = extra[key]
					if (typeof raw !== 'string' || raw.length === 0) continue
					try {
						JSON.parse(raw)
					} catch {
						out.push(i)
						break
					}
				}
			}
			return out
		}
	}
}
