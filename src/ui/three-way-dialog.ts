function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getRoot(): HTMLElement {
  return document.getElementById('cn_app') ?? document.body
}

export type ThreeWayChoice = 'primary' | 'secondary' | 'cancel'

export function threeWayConfirm(
  title: string,
  message: string,
  primaryLabel: string,
  secondaryLabel: string,
  dangerSecondary = false
): Promise<ThreeWayChoice> {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = 'cn-dialog-mask'
    const box = document.createElement('div')
    box.className = 'cn-dialog'
    box.innerHTML = `
      <div class="cn-dialog__bar"></div>
      <div class="cn-dialog__hd">
        <i class="fa-solid fa-brain cn-dialog__brand-ico"></i>
        <span class="cn-dialog__brand">CranialNerve</span>
        <span class="cn-dialog__title">${escapeHtml(title)}</span>
        <button class="cn-dialog__close" id="cn-3dlg-x" type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cn-dialog__body">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
      <div class="cn-dialog__foot">
        <button class="cn-btn" id="cn-3dlg-cancel" type="button">取消</button>
        <button class="cn-btn ${dangerSecondary ? 'cn-btn--danger' : ''}" id="cn-3dlg-secondary" type="button">${escapeHtml(secondaryLabel)}</button>
        <button class="cn-btn cn-btn--primary" id="cn-3dlg-primary" type="button">${escapeHtml(primaryLabel)}</button>
      </div>
    `
    mask.appendChild(box)
    getRoot().appendChild(mask)
    requestAnimationFrame(() => mask.classList.add('cn-dialog-mask--show'))

    function cleanup() {
      mask.classList.remove('cn-dialog-mask--show')
      setTimeout(() => mask.remove(), 200)
    }
    const finish = (choice: ThreeWayChoice) => {
      resolve(choice)
      cleanup()
    }
    mask.addEventListener('click', (e) => {
      if (e.target === mask) finish('cancel')
    })
    box.querySelector('#cn-3dlg-cancel')!.addEventListener('click', () => finish('cancel'))
    box.querySelector('#cn-3dlg-x')!.addEventListener('click', () => finish('cancel'))
    box.querySelector('#cn-3dlg-secondary')!.addEventListener('click', () => finish('secondary'))
    box.querySelector('#cn-3dlg-primary')!.addEventListener('click', () => finish('primary'))
  })
}
