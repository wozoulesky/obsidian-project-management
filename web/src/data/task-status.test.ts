import { describe, expect, it } from 'vitest'

import type { TaskStatus } from './domain'
import { progressForStatus } from './task-status'

describe('progressForStatus', () => {
  it.each([
    ['not_started', 0, 0],
    ['not_started', 100, 0],
    ['done', 0, 100],
    ['done', 100, 100],
    ['in_progress', 0, 1],
    ['in_progress', 1, 1],
    ['in_progress', 42, 42],
    ['in_progress', 99, 99],
    ['in_progress', 100, 99],
    ['overdue', 0, 1],
    ['overdue', 1, 1],
    ['overdue', 42, 42],
    ['overdue', 99, 99],
    ['overdue', 100, 99],
  ] satisfies [TaskStatus, number, number][])(
    'normalizes %s progress %i to %i',
    (status, currentProgress, expected) => {
      expect(progressForStatus(status, currentProgress)).toBe(expected)
    },
  )
})
