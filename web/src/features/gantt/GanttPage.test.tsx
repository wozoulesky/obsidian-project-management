import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Task } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { GanttPage } from './GanttPage'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-051',
    code: 'TASK-051',
    title: 'MCP 权限校验',
    description: '校验服务权限',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-07-24',
    dueDate: '2026-07-28',
    priority: 'P0',
    status: 'in_progress',
    progress: 62,
    milestoneId: 'm2',
    dependencyIds: [],
    ...overrides,
  }
}

const ganttTasks = [
  task(),
  task({
    id: 'task-047',
    code: 'TASK-047',
    title: '断线恢复测试',
    startDate: '2026-07-29',
    dueDate: '2026-08-01',
    status: 'not_started',
    progress: 0,
    dependencyIds: ['task-051'],
  }),
  task({
    id: 'task-063',
    code: 'TASK-063',
    title: '甘特图渲染',
    startDate: '2026-08-03',
    dueDate: '2026-08-07',
    milestoneId: 'm3',
    dependencyIds: ['task-047'],
  }),
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

function mockTasks(tasks: Task[] = ganttTasks) {
  vi.spyOn(projectRepository, 'listGanttTasks').mockResolvedValue(tasks)
}

describe('GanttPage layout', () => {
  it('uses one visible row model for the synchronized task tree and timeline', async () => {
    mockTasks()
    const user = userEvent.setup()
    const { container } = renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 MCP 权限校验' })
    const treeRows = container.querySelectorAll(
      '.gantt-task-tree__rows [data-row-id]',
    )
    const timelineRows = container.querySelectorAll(
      '.gantt-timeline__rows [data-row-id]',
    )
    expect(Array.from(treeRows, (row) => row.getAttribute('data-row-id'))).toEqual(
      Array.from(timelineRows, (row) => row.getAttribute('data-row-id')),
    )
    expect(container.querySelector('.gantt-layout')).toHaveStyle(
      '--gantt-row-height: 2.75rem',
    )

    await user.click(screen.getByRole('button', { name: '里程碑 m2' }))
    expect(screen.getByRole('button', { name: '里程碑 m2' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(container.querySelectorAll('.gantt-task-tree__rows [data-row-id]')).toHaveLength(3)
    expect(container.querySelectorAll('.gantt-timeline__rows [data-row-id]')).toHaveLength(3)
  })

  it('changes tick density and visible range when the typed scale changes', async () => {
    mockTasks()
    const user = userEvent.setup()
    const { container } = renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 MCP 权限校验' })
    const weekTicks = container.querySelectorAll('.gantt-timeline__tick')
    const initialRange = screen.getByTestId('gantt-range').textContent
    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: '日' }))

    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(container.querySelectorAll('.gantt-timeline__tick').length).toBeGreaterThan(
      weekTicks.length,
    )
    expect(screen.getByTestId('gantt-range').textContent).not.toBe(initialRange)
  })

  it('shows today, milestones, progress, and an accessible risky dependency', async () => {
    mockTasks([
      task({ status: 'overdue' }),
      ganttTasks[1]!,
      ganttTasks[2]!,
    ])
    const { container } = renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 MCP 权限校验' })
    expect(container.querySelector('.gantt-timeline__today')).toHaveAttribute(
      'data-date',
      '2026-07-28',
    )
    expect(container.querySelectorAll('.gantt-milestone')).toHaveLength(2)
    expect(container.querySelector('.gantt-task-bar__progress')).toHaveStyle(
      'width: 62%',
    )
    expect(
      screen.getByText('MCP 权限校验 → 断线恢复测试（前置任务已逾期）'),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-dependency="task-051-task-047"]')).toHaveClass(
      'is-risk',
    )
  })

  it('renders loading, error, and empty states', async () => {
    let resolveTasks!: (tasks: Task[]) => void
    vi.spyOn(projectRepository, 'listGanttTasks').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTasks = resolve
        }),
    )
    const loading = renderApp(<GanttPage />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载甘特图')
    resolveTasks([])
    expect(await screen.findByText('暂无排期任务')).toBeInTheDocument()
    loading.unmount()

    vi.spyOn(projectRepository, 'listGanttTasks').mockRejectedValueOnce(
      new Error('排期服务不可用'),
    )
    renderApp(<GanttPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('排期服务不可用')
  })
})

describe('GanttPage scheduling workflow', () => {
  it('previews keyboard moves, cancels without writing, then confirms the API mutation', async () => {
    mockTasks()
    const update = vi
      .spyOn(projectRepository, 'updateTaskDates')
      .mockResolvedValue(task({ startDate: '2026-07-25', dueDate: '2026-07-29' }))
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    const bar = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    bar.focus()
    await user.keyboard('{ArrowRight}')
    const summary =
      'MCP 权限校验：7 月 24 日–7 月 28 日 → 7 月 25 日–7 月 29 日'
    expect(screen.getByText(summary)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消排期调整' }))
    expect(update).not.toHaveBeenCalled()

    bar.focus()
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('button', { name: '确认排期调整' }))
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('task-051', {
        startDate: '2026-07-25',
        dueDate: '2026-07-29',
      })
    })
  })

  it('only resizes from the handle with Shift plus arrow and never reverses dates', async () => {
    mockTasks()
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    const handle = await screen.findByRole('button', {
      name: '调整 MCP 权限校验 截止日期',
    })
    handle.focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.queryByText(/MCP 权限校验：/)).not.toBeInTheDocument()

    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(
      screen.getByText(
        'MCP 权限校验：7 月 24 日–7 月 28 日 → 7 月 24 日–7 月 27 日',
      ),
    ).toBeInTheDocument()
  })

  it('retains a failed proposal for retry and blocks duplicate pending confirmation', async () => {
    mockTasks()
    let rejectUpdate!: (error: Error) => void
    const update = vi
      .spyOn(projectRepository, 'updateTaskDates')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject
          }),
      )
      .mockResolvedValueOnce(
        task({ startDate: '2026-07-25', dueDate: '2026-07-29' }),
      )
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    const bar = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    bar.focus()
    await user.keyboard('{ArrowRight}')
    const confirm = screen.getByRole('button', { name: '确认排期调整' })
    await user.click(confirm)
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(update).toHaveBeenCalledTimes(1)

    rejectUpdate(new Error('保存排期失败'))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存排期失败')
    expect(
      screen.getByText(/MCP 权限校验：7 月 24 日/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试排期调整' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  })

  it('opens the inspector from the latest task snapshot and restores focus', async () => {
    mockTasks()
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    const trigger = await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'MCP 权限校验' })).toBeVisible()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '关闭 MCP 权限校验',
      }),
    )
    expect(trigger).toHaveFocus()
  })

  it('cleans up pointer previews when a drag is cancelled', async () => {
    mockTasks()
    renderApp(<GanttPage />)
    const bar = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    Object.defineProperty(bar, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 7 })
    fireEvent.pointerMove(bar, { clientX: 140, pointerId: 7 })
    fireEvent.pointerCancel(bar, { pointerId: 7 })
    expect(screen.queryByText(/MCP 权限校验：/)).not.toBeInTheDocument()
  })
})

describe('Gantt route', () => {
  it('lazy-loads the planning workspace instead of the placeholder', async () => {
    mockTasks()
    renderApp(<AppRoutes />, { route: '/gantt' })

    expect(
      await screen.findByRole('heading', { name: '项目排期' }),
    ).toBeInTheDocument()
  })
})
