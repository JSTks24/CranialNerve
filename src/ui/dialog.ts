import toast from './toast'

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

type DialogResolve = (v: boolean | string | null) => void
let activeResolver: DialogResolve | null = null
let activeEl: HTMLElement | null = null

function dismissEl(el: HTMLElement): void {
  el.classList.remove('cn-dialog-mask--show')
  setTimeout(() => el.remove(), 200)
}

function closeLatest() {
  if (activeResolver) {
    activeResolver(null)
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
    activeResolver = (v) => {
      resolve(v === true)
    }
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

function promptRename(
  title: string,
  message: string,
  initialValue: string,
  confirmLabel = '保存'
): Promise<string | null> {
  closeLatest()
  return new Promise((resolve) => {
    activeResolver = (v) => {
      resolve(typeof v === 'string' ? v : null)
    }
    const mask = createMask()
    const box = document.createElement('div')
    box.className = 'cn-dialog cn-dialog--form'
    box.innerHTML = `
      <div class="cn-dialog__bar"></div>
      <div class="cn-dialog__hd">
        <i class="fa-solid fa-brain cn-dialog__brand-ico"></i>
        <span class="cn-dialog__brand">CranialNerve</span>
        <span class="cn-dialog__title">${escapeHtml(title)}</span>
        <button class="cn-dialog__close" id="cn-dlg-x" type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cn-dialog__body cn-dialog__body--form">
        <label class="cn-dialog__field-label" for="cn-dlg-input">预设名称</label>
        <input class="cn-input cn-dialog__field" id="cn-dlg-input" type="text" maxlength="60" />
        <span class="cn-dialog__field-hint">${escapeHtml(message)}</span>
      </div>
      <div class="cn-dialog__foot">
        <button class="cn-btn" id="cn-dlg-cancel" type="button">取消</button>
        <button class="cn-btn cn-btn--primary" id="cn-dlg-ok" type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    `
    mask.appendChild(box)
    getRoot().appendChild(mask)
    activeEl = mask
    const input = box.querySelector('#cn-dlg-input') as HTMLInputElement
    input.value = initialValue
    const finish = (value: string | null) => {
      resolve(value)
      cleanup()
    }
    const submit = () => {
      const v = input.value.trim()
      if (!v) {
        toast.error('预设名称不能为空')
        input.classList.add('cn-input--error')
        input.focus()
        return
      }
      finish(v)
    }
    box.querySelector('#cn-dlg-cancel')!.addEventListener('click', () => finish(null))
    box.querySelector('#cn-dlg-x')!.addEventListener('click', () => finish(null))
    box.querySelector('#cn-dlg-ok')!.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
      else if (e.key === 'Escape') finish(null)
    })
    input.addEventListener('input', () => {
      input.classList.remove('cn-input--error')
    })
    input.focus()
    input.select()
    requestAnimationFrame(() => mask.classList.add('cn-dialog-mask--show'))
  })
}

export default confirm
export { promptRename }
