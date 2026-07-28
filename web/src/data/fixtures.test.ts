import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFixtureSeed,
  createLargeTaskFixture,
} from './fixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('large deterministic task fixtures', () => {
  it('creates exactly 10,000 tasks with stable unique IDs and no randomness or current time', () => {
    const random = vi
      .spyOn(Math, 'random')
      .mockImplementation(() => {
        throw new Error('large fixtures must not use randomness')
      })
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('large fixtures must not use current time')
    })

    const first = createLargeTaskFixture()
    const second = createLargeTaskFixture()

    expect(first).toHaveLength(10_000)
    expect(new Set(first.map(({ id }) => id)).size).toBe(10_000)
    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id))
    expect(first[0]?.id).toBe('large-task-00001')
    expect(first.at(-1)?.id).toBe('large-task-10000')
    expect(random).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
  })

  it('keeps the default fixture seed compact', () => {
    expect(createFixtureSeed().tasks).toHaveLength(50)
  })
})
