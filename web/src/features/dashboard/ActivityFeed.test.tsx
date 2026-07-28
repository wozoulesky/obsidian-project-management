import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ActivityEvent } from '../../data/domain'
import { ActivityFeed } from './ActivityFeed'

const actor = {
  id: 'qa-agent',
  name: 'qa-agent',
  kind: 'agent',
  role: 'qa-agent',
} as const

function activity(
  id: string,
  createdAt: string,
): ActivityEvent {
  return {
    id,
    actor,
    action: `活动 ${id}`,
    operation: 'task.update',
    createdAt,
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ActivityFeed', () => {
  it('labels current, future, hourly and daily activity from the current clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00+08:00'))

    render(
      <ActivityFeed
        activities={[
          activity('now', '2026-08-01T12:00:00+08:00'),
          activity('future', '2026-08-01T12:05:00+08:00'),
          activity('hours', '2026-08-01T10:00:00+08:00'),
          activity('days', '2026-07-30T12:00:00+08:00'),
        ]}
      />,
    )

    expect(screen.getByText('刚刚')).toBeInTheDocument()
    expect(screen.getByText('稍后')).toBeInTheDocument()
    expect(screen.getByText('2 小时前')).toBeInTheDocument()
    expect(screen.getByText('2 天前')).toBeInTheDocument()
  })
})
