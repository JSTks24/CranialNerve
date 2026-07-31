import { getHostContext } from './host-context'

export function getPersonaDescription(): string {
	try {
		const ctx = getHostContext()
		const fromContext = ctx.powerUserSettings?.persona_description
		if (fromContext) {
			return fromContext
		}
		const powerUser = (window as unknown as { power_user?: { persona_description?: string } }).power_user
		return powerUser?.persona_description ?? ''
	} catch {
		return ''
	}
}

export function getCharDescription(): string {
	try {
		const ctx = getHostContext()
		const id = ctx.characterId
		const character = id != null ? ctx.characters?.[Number(id)] : undefined
		const fromChar = character?.description || character?.data?.description
		if (fromChar) {
			return fromChar
		}
		return ctx.name2_description ?? ''
	} catch {
		return ''
	}
}

export function getUserName(): string {
	try {
		return getHostContext().name1 || 'User'
	} catch {
		return 'User'
	}
}
