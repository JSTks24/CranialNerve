import type { CranialNerveSession } from '@core/session'
import { RECALL_FIELD_PREFIX, RECALL_FADE_MIN_DEPTH } from '@shared/constants'
import {
  EVENT_CHAT_LOADED,
  EVENT_MESSAGE_DELETED,
  EVENT_MESSAGE_EDITED,
  EVENT_MESSAGE_SWIPED,
  EVENT_MESSAGE_UPDATED,
  EVENT_MORE_MESSAGES_LOADED,
  EVENT_USER_MESSAGE_RENDERED,
} from '@shared/constants/events'
import { parseRecallPayload, stripKeyLineFromMes } from '@shared/recall-payload'
import recallCardCss from './recall-card.css?inline'
import { buildRecallCardHtml } from './template'

const HOST_CLASS = 'cn-recall-host'
const FLOOR_CLASS = 'cn-has-recall'

export interface RecallRenderer {
  renderFloor: (msgId: number) => void
  rescanAll: () => void
  dispose: () => void
}

export function installRecallRenderer(session: CranialNerveSession): RecallRenderer {
  let disposed = false

  const getFloorEl = (msgId: number): Element | null =>
    document.querySelector(`#chat .mes[mesid="${msgId}"]`)

  const readPayload = (msgId: number) => {
    try {
      return parseRecallPayload(session.chat.readMessageExtra(msgId, RECALL_FIELD_PREFIX))
    } catch {
      return null
    }
  }

  const removeHost = (mesText: Element): void => {
    mesText.querySelector(`:scope > .${HOST_CLASS}`)?.remove()
  }

  const cleanupFloorEl = (mesEl: Element): void => {
    mesEl.classList.remove(FLOOR_CLASS)
    const mesText = mesEl.querySelector('.mes_text')
    if (mesText) {
      removeHost(mesText)
    }
  }

  const makeHost = (innerHtml: string): HTMLDivElement => {
    const host = document.createElement('div')
    host.className = HOST_CLASS
    const shadow = host.attachShadow({ mode: 'open' })
    const styleEl = document.createElement('style')
    styleEl.textContent = recallCardCss
    shadow.appendChild(styleEl)
    const body = document.createElement('div')
    body.innerHTML = innerHtml
    shadow.appendChild(body)
    return host
  }

  const clearDomResidue = (): void => {
    for (const host of document.querySelectorAll(`#chat .mes_text > .${HOST_CLASS}`)) {
      host.remove()
    }
    for (const el of document.querySelectorAll(`#chat .mes.${FLOOR_CLASS}`)) {
      el.classList.remove(FLOOR_CLASS)
    }
  }

  function renderFloor(msgId: number): void {
    if (disposed) {
      return
    }
    const mesEl = getFloorEl(msgId)
    if (!mesEl) {
      return
    }
    const mesText = mesEl.querySelector('.mes_text')
    if (!mesText) {
      return
    }
    const chat = session.chat.getChat()
    const msg = chat[msgId]
    if (!msg || !msg.is_user) {
      cleanupFloorEl(mesEl)
      return
    }
    const payload = session.getConfig().recallEnabled ? readPayload(msgId) : null
    if (!payload) {
      cleanupFloorEl(mesEl)
      return
    }
    if (mesText.querySelector('#curEditTextarea')) {
      return
    }
    const depth = chat.length - 1 - msgId
    const faded = depth >= RECALL_FADE_MIN_DEPTH
    removeHost(mesText)
    const userText = stripKeyLineFromMes(String(msg.mes ?? ''))
    const innerHtml = buildRecallCardHtml(payload, userText, faded)

    mesEl.classList.add(FLOOR_CLASS)
    mesText.prepend(makeHost(innerHtml))
  }

  const refreshAllFloors = (): void => {
    if (disposed) {
      return
    }
    const chat = session.chat.getChat()
    for (let i = 0; i < chat.length; i++) {
      const msg = chat[i]
      if (!msg || !msg.is_user) {
        continue
      }
      renderFloor(i)
    }
  }

  function rescanAll(): void {
    if (disposed) {
      return
    }
    clearDomResidue()
    refreshAllFloors()
  }

  const onReload = (): void => {
    rescanAll()
  }
  const onSingleFloor = (...args: unknown[]): void => {
    const id = args[0]
    if (typeof id === 'number') {
      renderFloor(id)
    }
  }
  const onUserRendered = (...args: unknown[]): void => {
    const id = args[0]
    if (typeof id !== 'number') {
      return
    }
    renderFloor(id)
    refreshAllFloors()
  }

  const bindings: Array<[string, (...args: unknown[]) => unknown]> = [
    [EVENT_CHAT_LOADED, onReload],
    [EVENT_MORE_MESSAGES_LOADED, onReload],
    [EVENT_MESSAGE_DELETED, onReload],
    [EVENT_USER_MESSAGE_RENDERED, onUserRendered],
    [EVENT_MESSAGE_UPDATED, onSingleFloor],
    [EVENT_MESSAGE_EDITED, onSingleFloor],
    [EVENT_MESSAGE_SWIPED, onSingleFloor],
  ]
  for (const [ev, fn] of bindings) {
    session.event.on(ev, fn)
  }

  const onBeforeUnload = (): void => {
    dispose()
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    for (const [ev, fn] of bindings) {
      session.event.off(ev, fn)
    }
    window.removeEventListener('beforeunload', onBeforeUnload)
    clearDomResidue()
  }

  return { renderFloor, rescanAll, dispose }
}
