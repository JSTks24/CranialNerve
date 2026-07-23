function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function createMask(): HTMLElement {
  const mask = document.createElement('div')
  mask.className = 'cn-dialog-mask'
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      closeLatest()
    }
  })
  return mask
}

let activeResolver: ((v: boolean) => void) | null = null
let activeEl: HTMLElement | null = null

function closeLatest() {
  if (activeResolver) {
    activeResolver(false)
    activeResolver = null
  }
  if (activeEl) {
    activeEl.remove()
    activeEl = null
  }
}

function getRoot(): HTMLElement {
  return document.getElementById('cn_app') ?? document.body
}

function confirm(
  title: string,
  message: string,
  confirmLabel = '确认',
  danger = false
): Promise<boolean> {
  closeLatest()
  return new Promise((resolve) => {
    activeResolver = resolve
    const mask = createMask()
    const box = document.createElement('div')
    box.className = 'cn-dialog'
    box.innerHTML = `
      <div class="cn-dialog__head">${escapeHtml(title)}</div>
      <div class="cn-dialog__body">${escapeHtml(message)}</div>
      <div class="cn-dialog__foot">
        <button class="cn-btn" id="cn-dlg-cancel">取消</button>
        <button class="cn-btn ${danger ? 'cn-btn--danger' : 'cn-btn--primary'}" id="cn-dlg-ok">${escapeHtml(confirmLabel)}</button>
      </div>
    `
    mask.appendChild(box)
    getRoot().appendChild(mask)
    activeEl = mask

    box.querySelector('#cn-dlg-cancel')!.addEventListener('click', () => {
      resolve(false)
      cleanup()
    })
    box.querySelector('#cn-dlg-ok')!.addEventListener('click', () => {
      resolve(true)
      cleanup()
    })
  })
}

function cleanup() {
  activeResolver = null
  if (activeEl) {
    activeEl.remove()
    activeEl = null
  }
}

export default confirm
