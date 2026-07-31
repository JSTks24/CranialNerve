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

function dismissEl(el: HTMLElement): void {
  el.classList.remove('cn-dialog-mask--show')
  setTimeout(() => el.remove(), 200)
}

function closeLatest() {
  if (activeResolver) {
    activeResolver(false)
    activeResolver = null
  }
  if (activeEl) {
    dismissEl(activeEl)
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
    box.className = 'cn-dialog' + (danger ? ' cn-dialog--danger' : '')
    box.innerHTML = `
      <div class="cn-dialog__bar"></div>
      <div class="cn-dialog__hd">
        <i class="fa-solid fa-brain cn-dialog__brand-ico"></i>
        <span class="cn-dialog__brand">CranialNerve</span>
        <span class="cn-dialog__title">${escapeHtml(title)}</span>
        <button class="cn-dialog__close" id="cn-dlg-x" type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cn-dialog__body">${escapeHtml(message)}</div>
      <div class="cn-dialog__foot">
        <button class="cn-btn" id="cn-dlg-cancel" type="button">取消</button>
        <button class="cn-btn ${danger ? 'cn-btn--danger' : 'cn-btn--primary'}" id="cn-dlg-ok" type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    `
    mask.appendChild(box)
    getRoot().appendChild(mask)
    activeEl = mask
    requestAnimationFrame(() => mask.classList.add('cn-dialog-mask--show'))

    const cancel = () => {
      resolve(false)
      cleanup()
    }
    box.querySelector('#cn-dlg-cancel')!.addEventListener('click', cancel)
    box.querySelector('#cn-dlg-x')!.addEventListener('click', cancel)
    box.querySelector('#cn-dlg-ok')!.addEventListener('click', () => {
      resolve(true)
      cleanup()
    })
  })
}

function cleanup() {
  activeResolver = null
  if (activeEl) {
    dismissEl(activeEl)
    activeEl = null
  }
}

export default confirm
