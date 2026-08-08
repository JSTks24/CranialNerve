import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PREVIEW_PATH = join(__dirname, '..', '..', 'CranialNerveDocument', 'recall-card-preview.html')

describe('recall-card-preview.html 防漂移守卫', () => {
  const preview = existsSync(PREVIEW_PATH) ? readFileSync(PREVIEW_PATH, 'utf8') : null

  it('预览文件存在于文档目录', () => {
    expect(preview).not.toBeNull()
  })

  it('含三种卡片的关键 class 标记', () => {
    if (preview == null) return
    expect(preview).toContain('cn-recall-tabs')
    expect(preview).toContain('cn-recall-card__faded')
    expect(preview).toContain('cn-recall-card__opening')
  })

  it('含三形态文案', () => {
    if (preview == null) return
    expect(preview).toContain('楼层久远，记忆随风而去')
    expect(preview).toContain('故事的序幕，由你亲手揭开')
    expect(preview).toContain('本回合输入')
  })

  it('含触发条件说明', () => {
    if (preview == null) return
    expect(preview).toContain('召回卡片')
    expect(preview).toContain('记忆消逝')
    expect(preview).toContain('开场白')
  })
})
