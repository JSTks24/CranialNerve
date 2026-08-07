import { describe, expect, it } from 'vitest'
import createWriteQueue from '../src/core/write-queue'

describe('写队列超时后继续等待', () => {
  it('waitForDrain 超时 reject 后，无超时 waitForDrain 仍等到底', async () => {
    const q = createWriteQueue()
    let done = false
    const task = q.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      done = true
    })
    await expect(q.waitForDrain(5)).rejects.toThrow('write queue drain timeout')
    expect(done).toBe(false)
    await q.waitForDrain()
    expect(done).toBe(true)
    await task
  })

  it('队列空时 waitForDrain 立即完成', async () => {
    const q = createWriteQueue()
    await q.waitForDrain()
    expect(q.isPending()).toBe(false)
  })
})
