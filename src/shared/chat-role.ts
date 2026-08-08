export interface ChatRoleLike {
  is_user?: boolean
  is_system?: boolean
}

export function isGreetingFloor(chat: ChatRoleLike[], msg: ChatRoleLike): boolean {
  const first = chat[0]
  if (!first || msg !== first) return false
  return !first.is_user && !first.is_system
}

export function isFirstUserFloorAfterGreeting(chat: ChatRoleLike[], msgId: number): boolean {
  const first = chat[0]
  if (!first || first.is_user || first.is_system) return false
  for (let i = 1; i < chat.length; i++) {
    const m = chat[i]
    if (!m || m.is_system) continue
    if (m.is_user) return i === msgId
    return false
  }
  return false
}
