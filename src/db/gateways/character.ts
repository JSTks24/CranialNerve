import type { CardTemplate } from '@shared/types/card'
import { getHostContext } from './host-context'

export interface CharacterGateway {
    readTemplateFromCard(): CardTemplate | null
}

export default function createCharacterGateway(): CharacterGateway {
    return {
        readTemplateFromCard() {
            const ctx = getHostContext()
            const id = ctx.characterId
            if (id == null) {
                return null
            }
            const character = ctx.characters[id]
            const raw = character?.data?.extensions?.['cranialnerve']
            if (raw == null) {
                return null
            }
            return validateTemplate(raw)
        },
    }
}

function validateTemplate(raw: unknown): CardTemplate {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('invalid card template: not an object')
    }
    const obj = raw as Record<string, unknown>
    if (typeof obj.templateVersion !== 'number') {
        throw new Error('invalid card template: templateVersion is not a number')
    }
    if (!Array.isArray(obj.tables)) {
        throw new Error('invalid card template: tables is not an array')
    }
    return obj as unknown as CardTemplate
}
