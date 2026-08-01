import type { RecallCardPayload } from '@shared/types/recall-card'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function svgIcon(cls: string, paths: string): string {
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  )
}

const BRAIN_PATHS =
  '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>' +
  '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>' +
  '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>' +
  '<path d="M12 13v8"/>'

export function buildRecallCardHtml(payload: RecallCardPayload, userText: string): string {
  const items = payload.items
  const uid = Math.random().toString(36).slice(2, 10)
  const countText = `${items.length} 条记忆`

  let tabsHtml = ''
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) {
      continue
    }
    const checked = i === 0 ? ' checked' : ''
    const rid = `r-${uid}-${i}`

    tabsHtml += `<input type="radio" name="r-${uid}" id="${rid}" class="cn-recall-tabs__radio"${checked}>`
    tabsHtml += `<label for="${rid}" class="cn-recall-tab">`
    tabsHtml += `<span class="cn-recall-tab__key">${escapeHtml(item.key)}</span>`
    tabsHtml += `<span class="cn-recall-tab__time">${escapeHtml(item.timeDeltaText)}</span>`
    tabsHtml += `</label>`

    const timeRange = [item.timeStart, item.timeEnd].filter((s) => s.length > 0)
    let meta = ''
    if (timeRange.length > 0) {
      meta += `<span class="cn-recall-meta__chip"><span class="cn-recall-meta__label">时间</span>${escapeHtml(timeRange.join(' ~ '))}</span>`
    }
    if (item.location.length > 0) {
      meta += `<span class="cn-recall-meta__chip"><span class="cn-recall-meta__label">地点</span>${escapeHtml(item.location)}</span>`
    }

    tabsHtml += `<div class="cn-recall-panel">`
    if (meta.length > 0) {
      tabsHtml += `<div class="cn-recall-meta">${meta}</div>`
    }
    if (item.summary.length > 0) {
      tabsHtml += `<p class="cn-recall-summary">${escapeHtml(item.summary)}</p>`
    }
    if (item.keyDialogue.length > 0) {
      tabsHtml += `<blockquote class="cn-recall-quote">${escapeHtml(item.keyDialogue)}</blockquote>`
    }
    tabsHtml += `</div>`
  }

  return (
    `<div class="cn-recall-card">` +
    `<div class="cn-recall-card__head">${svgIcon('cn-recall-card__icon', BRAIN_PATHS)}<span class="cn-recall-card__brand">CranialNerve</span><span class="cn-recall-card__count">${countText}</span></div>` +
    `<div class="cn-recall-tabs">${tabsHtml}</div>` +
    `<div class="cn-recall-card__message"><span class="cn-recall-card__tag">本回合输入</span>${escapeHtml(userText)}</div>` +
    `</div>`
  )
}

export function buildRecallFadedHtml(): string {
  return (
    `<div class="cn-recall-faded">` +
    `<span class="cn-recall-faded__rule cn-recall-faded__rule--left"></span>` +
    svgIcon('cn-recall-faded__icon', FEATHER_PATHS) +
    `<span class="cn-recall-faded__text">楼层久远，记忆随风而去</span>` +
    `<span class="cn-recall-faded__rule cn-recall-faded__rule--right"></span>` +
    `</div>`
  )
}
