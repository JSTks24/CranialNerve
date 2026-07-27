export const WORLD_INFO_LOGIC = {
	AND_ANY: 0,
	NOT_ALL: 1,
	NOT_ANY: 2,
	AND_ALL: 3,
} as const

export interface CharacterFilter {
	names: string[]
	isExclude: boolean
	tags: string[]
}

export interface ScanEntry {
	uid: number
	key: string[]
	keysecondary: string[]
	content: string
	comment: string
	constant: boolean
	selective: boolean
	disable: boolean
	position: number
	depth: number
	order: number
	world: string
	caseSensitive: boolean
	matchWholeWords: boolean
	selectiveLogic: number
	preventRecursion: boolean
	excludeRecursion: boolean
	delayUntilRecursion: number | boolean
	scanDepth: number | null
	decorators: string[]
	triggers: string[]
	characterFilter: CharacterFilter | null
	enabled: boolean
}

export interface ScanOptions {
	trigger?: string
	characterName?: string
	characterTagMap?: Record<string, string[]>
	maxRecursionPasses?: number
}
