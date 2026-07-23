type ToastType = 'success' | 'error' | 'warning' | 'info'

const ICONS: Record<ToastType, string> = {
  success: 'fa-solid fa-circle-check',
  error: 'fa-solid fa-circle-exclamation',
  warning: 'fa-solid fa-triangle-exclamation',
  info: 'fa-solid fa-circle-info'
}

let styleInjected = false
let viewport: HTMLElement | null = null

function injectStyle(): void {
  if (styleInjected) return
  const s = document.createElement('style')
  s.id = 'cn_toast_style'
  s.textContent = `
.cn-toast-vp{position:fixed;top:16px;right:16px;z-index:10010;display:flex;flex-direction:column;gap:10px;pointer-events:none}
.cn-toast{display:flex;flex-direction:column;width:360px;max-width:calc(100vw-32px);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.15);overflow:hidden;pointer-events:auto;opacity:0;transform:translateX(16px);transition:opacity .25s ease,transform .25s ease}
.cn-toast--show{opacity:1;transform:translateX(0)}
.cn-toast__hd{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#fff;border:1px solid #e8e8e8;border-bottom:0;border-radius:8px 8px 0 0;font-size:13px;font-weight:600;color:#1f1f1f}
.cn-toast__hd i{font-size:16px}
.cn-toast__bd{padding:10px 14px 12px;background:#fff;border:1px solid #e8e8e8;border-top:0;font-size:14px;line-height:1.6;color:#595959}
.cn-toast__bd i{font-size:16px;margin-right:6px;vertical-align:-2px}
.cn-toast--success{border-left:4px solid #52c41a}
.cn-toast--error{border-left:4px solid #ff4d4f}
.cn-toast--warning{border-left:4px solid #faad14}
.cn-toast--info{border-left:4px solid #1677ff}
.cn-toast--success .cn-toast__hd i,.cn-toast--success .cn-toast__bd i{color:#52c41a}
.cn-toast--error .cn-toast__hd i,.cn-toast--error .cn-toast__bd i{color:#ff4d4f}
.cn-toast--warning .cn-toast__hd i,.cn-toast--warning .cn-toast__bd i{color:#faad14}
.cn-toast--info .cn-toast__hd i,.cn-toast--info .cn-toast__bd i{color:#1677ff}
.cn-toast__ft{padding:6px 14px 10px;display:flex;justify-content:flex-end;background:#fff;border:1px solid #e8e8e8;border-top:0;border-radius:0 0 8px 8px}
.cn-toast__term{height:24px;padding:0 12px;border:1px solid #ff4d4f;border-radius:4px;background:#fff;color:#ff4d4f;font-size:12px;cursor:pointer}
.cn-toast__term:hover{background:#fff1f0}
	.cn-toast__close{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;margin-left:auto;border:0;border-radius:4px;background:transparent;color:#8c8c8c;font-size:13px;cursor:pointer;flex-shrink:0;transition:background 0.15s,color 0.15s}
	.cn-toast__close:hover{background:#f0f0f0;color:#1f1f1f}
.cn-toast--progress .cn-toast__bd i{color:#1677ff}
.cn-toast--progress{border-left:4px solid #1677ff}
`
  document.head.appendChild(s)
  styleInjected = true
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getViewport(): HTMLElement {
  if (viewport && document.body.contains(viewport)) return viewport
  viewport = document.createElement('div')
  viewport.className = 'cn-toast-vp'
  document.body.appendChild(viewport)
  return viewport
}

function show(type: ToastType, text: string): void {
  injectStyle()
  const vp = getViewport()
  const item = document.createElement('div')
  item.className = `cn-toast cn-toast--${type}`
  item.innerHTML = `
    <div class="cn-toast__hd">
      <i class="fa-solid fa-brain" style="color:#52c41a"></i>
      <span>CranialNerve</span>
      <button class="cn-toast__close" type="button"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="cn-toast__bd">
      <i class="${ICONS[type]}"></i>
      <span>${escapeHtml(text)}</span>
    </div>
  `
  vp.appendChild(item)
  const closeBtn = item.querySelector('.cn-toast__close') as HTMLButtonElement
  const autoCloseTimer = setTimeout(() => {
    item.classList.remove('cn-toast--show')
    setTimeout(() => item.remove(), 300)
  }, 4000)
  closeBtn.addEventListener('click', () => {
    clearTimeout(autoCloseTimer)
    item.classList.remove('cn-toast--show')
    setTimeout(() => item.remove(), 300)
  })
  requestAnimationFrame(() => {
    item.classList.add('cn-toast--show')
  })
}

function progress(text: string): {
  done(): void
  fail(errText: string): void
  abortSignal: AbortSignal
} {
  injectStyle()
  const vp = getViewport()
  const ctrl = new AbortController()
  const item = document.createElement('div')
  item.className = 'cn-toast cn-toast--progress cn-toast--show'
  item.innerHTML = `
    <div class="cn-toast__hd">
      <i class="fa-solid fa-brain" style="color:#52c41a"></i>
      <span>CranialNerve</span>
      <button class="cn-toast__close" type="button"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="cn-toast__bd">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>正在处理... ${escapeHtml(text)}</span>
    </div>
    <div class="cn-toast__ft">
      <button class="cn-toast__term">终止</button>
    </div>
  `
  vp.appendChild(item)
  const closeBtn = item.querySelector('.cn-toast__close') as HTMLButtonElement
  closeBtn.addEventListener('click', () => {
    ctrl.abort()
    item.classList.remove('cn-toast--show')
    setTimeout(() => item.remove(), 300)
  })
  const termBtn = item.querySelector('.cn-toast__term') as HTMLButtonElement
  termBtn.addEventListener('click', () => {
    ctrl.abort()
    item.classList.remove('cn-toast--show')
    setTimeout(() => item.remove(), 300)
  })

  return {
    done() {
      item.classList.remove('cn-toast--progress')
      item.classList.add('cn-toast--success')
      const bd = item.querySelector('.cn-toast__bd')!
      bd.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>&#x5df2;&#x5b8c;&#x6210;</span>'
      item.querySelector('.cn-toast__ft')?.remove()
      setTimeout(() => {
        item.classList.remove('cn-toast--show')
        setTimeout(() => item.remove(), 300)
      }, 2000)
    },
    fail(errText: string) {
      item.classList.remove('cn-toast--progress')
      item.classList.add('cn-toast--error')
      const bd = item.querySelector('.cn-toast__bd')!
      bd.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(errText)}</span>`
      item.querySelector('.cn-toast__ft')?.remove()
      setTimeout(() => {
        item.classList.remove('cn-toast--show')
        setTimeout(() => item.remove(), 300)
      }, 3000)
    },
    abortSignal: ctrl.signal
  }
}

const toast = {
  success: (text: string) => show('success', text),
  error: (text: string) => show('error', text),
  warning: (text: string) => show('warning', text),
  info: (text: string) => show('info', text),
  progress
}

export default toast
