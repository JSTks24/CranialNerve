import { describe, expect, it } from 'vitest'
import { CranialNerveSession } from '../src/core/session'
import { rollbackFillProgress } from '../src/core/table/fill-orchestrator'

const FILL_PROGRESS_KEY = 'CN_FILL_PROGRESS'

function makeSession(initial: Record<string, unknown> | null) {
  const meta: Record<string, unknown> = {}
  if (initial) meta[FILL_PROGRESS_KEY] = initial
  const session = {
    chat: {
      readChatMetadata: (k: string) => meta[k],
      writeChatMetadata: (k: string, v: unknown) => {
        if (v === undefined) delete meta[k]
        else meta[k] = v
      },
    },
  } as unknown as CranialNerveSession
  return { session, meta }
}

describe('rollbackFillProgress（1.6 修复：regenerate 删帧后回退填表进度，避免追平跳过）', () => {
  it('进度楼 >= 被删楼时回退对应场景', () => {
    const { session, meta } = makeSession({ tableFloor: 5, chronicleFloor: 3 })
    rollbackFillProgress(session, 4)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ chronicleFloor: 3 })
  })

  it('进度楼全部 >= 被删楼时清空元数据', () => {
    const { session, meta } = makeSession({ tableFloor: 5, chronicleFloor: 3 })
    rollbackFillProgress(session, 3)
    expect(meta[FILL_PROGRESS_KEY]).toBeUndefined()
  })

  it('进度楼全部 < 被删楼时保持不变', () => {
    const { session, meta } = makeSession({ tableFloor: 2, chronicleFloor: 1 })
    rollbackFillProgress(session, 4)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ tableFloor: 2, chronicleFloor: 1 })
  })

  it('无进度记录时无害', () => {
    const { session, meta } = makeSession(null)
    rollbackFillProgress(session, 4)
    expect(meta[FILL_PROGRESS_KEY]).toBeUndefined()
  })

  it('mergedFloor >= 被删楼时回退 mergedFloor（保留未删侧）', () => {
    const { session, meta } = makeSession({ mergedFloor: 5, tableFloor: 1 })
    rollbackFillProgress(session, 3)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ tableFloor: 1 })
  })

  it('mergedFloor 全部 >= 被删楼时清空元数据', () => {
    const { session, meta } = makeSession({ mergedFloor: 5, chronicleFloor: 3 })
    rollbackFillProgress(session, 3)
    expect(meta[FILL_PROGRESS_KEY]).toBeUndefined()
  })

  it('mergedFloor 未达被删楼时保留，仅回退超出的场景', () => {
    const { session, meta } = makeSession({ mergedFloor: 2, tableFloor: 5 })
    rollbackFillProgress(session, 4)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ mergedFloor: 2 })
  })
})
