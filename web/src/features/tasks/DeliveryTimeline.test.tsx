import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Task } from '../../data/domain'
import { DeliveryTimeline } from './DeliveryTimeline'

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-default',
    code: 'TASK-DEFAULT',
    title: '默认任务',
    description: '用于验证交付时间线。',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-07-20',
    dueDate: '2026-07-28',
    priority: 'P1',
    status: 'in_progress',
    progress: 50,
    milestoneId: 'm2',
    dependencyIds: [],
    ...overrides,
  }
}

afterEach(cleanup)

describe('DeliveryTimeline', () => {
  it('renders filtered task dates as a read-only semantic list', () => {
    const { container } = render(
      <DeliveryTimeline
        selectedTaskId="selected"
        tasks={[
          task({ id: 'first', code: 'TASK-1', title: '第一项' }),
          task({
            id: 'selected',
            code: 'TASK-2',
            title: '选中项',
            startDate: '2026-07-22',
            dueDate: '2026-07-30',
            status: 'overdue',
          }),
        ]}
      />,
    )

    const timeline = screen.getByRole('region', { name: '交付时间线' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('time[datetime="2026-07-20"]'))
      .toHaveTextContent('2026-07-20')
    expect(container.querySelector('time[datetime="2026-07-30"]'))
      .toHaveTextContent('2026-07-30')
    expect(container.querySelector('li[aria-current="true"]'))
      .toHaveTextContent('选中项')
    expect(within(timeline).queryByRole('button')).not.toBeInTheDocument()
  })

  it('announces an empty filtered result', () => {
    render(<DeliveryTimeline selectedTaskId={null} tasks={[]} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      '当前筛选范围暂无交付节点',
    )
  })
})
