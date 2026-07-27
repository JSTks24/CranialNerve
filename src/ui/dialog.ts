let styleInjected = false

function injectStyles(): void {
  if (styleInjected) return
  const s = document.createElement('style')
  s.id = 'cn_dialog_style'
  s.textContent = `
.cn-dialog-mask{position:fixed;inset:0;z-index:var(--cn-z-dialog);display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)!important}
.cn-dialog{background:#fff!important;border-radius:6px!important;box-shadow:0 6px 16px rgba(0,0,0,.08),0 3px 6px rgba(0,0,0,.06)!important;min-width:320px;max-width:480px;overflow:hidden!important}
.cn-dialog__head{display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #e8e8e8!important;font-size:16px;font-weight:600;color:#1f1f1f!important}
.cn-dialog__body{padding:16px;font-size:14px;color:#595959!important;line-height:1.6;white-space:pre-wrap}
.cn-dialog__foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e8e8e8!important}
.cn-dialog__foot .cn-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 15px;border:1px solid #e8e8e8!important;border-radius:6px;background:#fff!important;color:#1f1f1f!important;font-size:14px;cursor:pointer}
.cn-dialog__foot .cn-btn--primary{background:#52c41a!important;border-color:#52c41a!important;color:#fff!important}
.cn-dialog__foot .cn-btn--danger{background:#ff4d4f!important;border-color:#ff4d4f!important;color:#fff!important}
`
  document.head.appendChild(s)
  styleInjected = true
}

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
  injectStyles()
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
