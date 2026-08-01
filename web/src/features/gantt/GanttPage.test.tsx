import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
  it('uses the shared glass header, real metrics, legend, and local stage', async () => {
    mockTasks([
      task(),
      task({ id: 'done', code: 'DONE', title: '完成任务', status: 'done' }),
      task({
        id: 'overdue',
        code: 'OVERDUE',
        title: '逾期任务',
        status: 'overdue',
      }),
      task({
        id: 'pending',
        code: 'PENDING',
        title: '待开始任务',
        status: 'not_started',
      }),
    ])
    const { container } = renderApp(<GanttPage />)

    expect(
      await screen.findByRole('heading', { name: '甘特排程' }),
    ).toBeVisible()
    expect(container.querySelector('.page-header')).toBeInTheDocument()
    const metrics = screen.getByRole('group', { name: '甘特关键指标' })
    const values = Object.fromEntries(
      Array.from(metrics.querySelectorAll<HTMLElement>('[data-metric]')).map(
        (metric) => [
          metric.dataset.metric,
          within(metric).getByTestId('gantt-metric-value').textContent,
        ],
      ),
    )
    expect(values).toEqual({
      计划任务: '4',
      进行中: '1',
      已完成: '1',
      逾期: '1',
    })
    expect(metrics.querySelectorAll('.glass-panel')).toHaveLength(4)
    expect(
      screen.getByRole('list', { name: '排期状态图例' }),
    ).toHaveTextContent('进行中逾期已完成待开始')
    const stage = screen.getByRole('region', { name: '甘特排程工作区' })
    expect(stage).toHaveClass('glass-panel', 'gantt-stage')
    expect(
      within(stage).getByLabelText('甘特图排期滚动区域'),
    ).toHaveClass('gantt-scroll-region')
    expect(container.querySelector('.gantt-task-bar--in_progress'))
      .toBeInTheDocument()
    expect(container.querySelector('.gantt-task-bar--overdue'))
      .toBeInTheDocument()
    expect(container.querySelector('.gantt-task-bar--done'))
      .toBeInTheDocument()
    expect(container.querySelector('.gantt-task-bar--not_started'))
      .toBeInTheDocument()
  })

  it('keeps 100-plus synchronized rows bounded and moves the window on scroll', async () => {
    const largeTasks = Array.from({ length: 240 }, (_, index) =>
      task({
        id: `large-${index}`,
        code: `LARGE-${index}`,
        title: `大型排期任务 ${index}`,
        milestoneId: 'large',
      }),
    )
    mockTasks(largeTasks)
    const { container } = renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 大型排期任务 0' })
    const scrollRegion = container.querySelector(
      '.gantt-scroll-region',
    ) as HTMLElement
    Object.defineProperty(scrollRegion, 'clientHeight', {
      configurable: true,
      value: 440,
    })

    const renderedTreeRows = () =>
      container.querySelectorAll('.gantt-task-tree__rows [data-row-id]')
    const renderedTimelineRows = () =>
      container.querySelectorAll('.gantt-timeline__rows [data-row-id]')
    expect(renderedTreeRows().length).toBeLessThan(50)
    expect(
      Array.from(renderedTreeRows(), (row) => row.getAttribute('data-row-id')),
    ).toEqual(
      Array.from(
        renderedTimelineRows(),
        (row) => row.getAttribute('data-row-id'),
      ),
    )

    fireEvent.scroll(scrollRegion, { target: { scrollTop: 4_400 } })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '查看 大型排期任务 100' }),
      ).toBeVisible()
    })
    expect(
      screen.queryByRole('button', { name: '查看 大型排期任务 0' }),
    ).not.toBeInTheDocument()
    expect(renderedTreeRows().length).toBeLessThan(50)
    expect(
      Array.from(renderedTreeRows(), (row) => row.getAttribute('data-row-id')),
    ).toEqual(
      Array.from(
        renderedTimelineRows(),
        (row) => row.getAttribute('data-row-id'),
      ),
    )
  })

  it('draws risky truncated dependencies at either rendered edge and omits off-window lines', async () => {
    const largeTasks = Array.from({ length: 240 }, (_, index) =>
      task({
        id: `long-${index}`,
        code: `LONG-${index}`,
        title: `长依赖任务 ${index}`,
        milestoneId: 'long',
        status: index === 0 ? 'overdue' : 'not_started',
        dependencyIds: index === 200 ? ['long-0'] : [],
      }),
    )
    mockTasks(largeTasks)
    const { container } = renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 长依赖任务 0' })
    const scrollRegion = container.querySelector(
      '.gantt-scroll-region',
    ) as HTMLElement
    Object.defineProperty(scrollRegion, 'clientHeight', {
      configurable: true,
      value: 440,
    })
    const dependency = () =>
      container.querySelector('[data-dependency="long-0-long-200"]')

    expect(dependency()).toHaveAttribute('data-truncated', 'bottom')
    expect(dependency()).toHaveAttribute('d', expect.stringMatching(/V 10$/))
    expect(dependency()).toHaveClass('is-truncated')
    expect(dependency()).toHaveClass('is-risk')
    expect(
      screen.getByText(
        '长依赖任务 0 → 长依赖任务 200（前置任务已逾期）',
      ),
    ).toBeInTheDocument()

    fireEvent.scroll(scrollRegion, { target: { scrollTop: 4_400 } })
    await screen.findByRole('button', { name: '查看 长依赖任务 100' })
    expect(dependency()).not.toBeInTheDocument()

    fireEvent.scroll(scrollRegion, { target: { scrollTop: 8_800 } })
    await screen.findByRole('button', { name: '查看 长依赖任务 200' })
    expect(dependency()).toHaveAttribute('data-truncated', 'top')
    expect(dependency()).toHaveAttribute(
      'd',
      expect.stringMatching(/ 200 V 201\.5$/),
    )
    expect(dependency()).toHaveClass('is-truncated')
    expect(dependency()).toHaveClass('is-risk')
  })

  it('moves focus to the labeled scroll region before a focused row unmounts', async () => {
    const largeTasks = Array.from({ length: 240 }, (_, index) =>
      task({
        id: `focus-${index}`,
        code: `FOCUS-${index}`,
        title: `焦点任务 ${index}`,
        milestoneId: 'focus',
      }),
    )
    mockTasks(largeTasks)
    const { container } = renderApp(<GanttPage />)

    const firstTask = await screen.findByRole('button', {
      name: '查看 焦点任务 0',
    })
    const scrollRegion = container.querySelector(
      '.gantt-scroll-region',
    ) as HTMLElement
    Object.defineProperty(scrollRegion, 'clientHeight', {
      configurable: true,
      value: 440,
    })
    firstTask.focus()
    expect(firstTask).toHaveFocus()

    fireEvent.scroll(scrollRegion, { target: { scrollTop: 4_400 } })

    await screen.findByRole('button', { name: '查看 焦点任务 100' })
    expect(scrollRegion).toHaveAttribute('tabindex', '0')
    expect(scrollRegion).toHaveAccessibleName('甘特图排期滚动区域')
    expect(scrollRegion).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })

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

  it('changes tick density and visible range with the shared range control', async () => {
    mockTasks()
    const user = userEvent.setup()
    const { container } = renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 MCP 权限校验' })
    const weekTicks = container.querySelectorAll('.gantt-timeline__tick')
    const initialRange = screen.getByTestId('gantt-range').textContent
    const rangeControl = screen.getByRole('group', {
      name: '甘特时间范围',
    })
    expect(within(rangeControl).getByRole('button', { name: '周' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(within(rangeControl).getByRole('button', { name: '季度' }))

    expect(within(rangeControl).getByRole('button', { name: '季度' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(container.querySelectorAll('.gantt-timeline__tick').length).not.toBe(
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
      within(
        screen.getByRole('region', { name: '甘特时间轴' }),
      ).getAllByText('62%')[0],
    ).toBeVisible()
    expect(
      screen.getByText('MCP 权限校验 → 断线恢复测试（前置任务已逾期）'),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-dependency="task-051-task-047"]')).toHaveClass(
      'is-risk',
    )
  })

  it('does not render bars for tasks fully outside the selected range', async () => {
    mockTasks([
      ...ganttTasks,
      task({
        id: 'task-before',
        code: 'TASK-BEFORE',
        title: '范围前任务',
        startDate: '2026-06-01',
        dueDate: '2026-06-03',
      }),
      task({
        id: 'task-after',
        code: 'TASK-AFTER',
        title: '范围后任务',
        startDate: '2026-09-01',
        dueDate: '2026-09-03',
      }),
    ])
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    await screen.findByRole('button', { name: '查看 范围前任务' })
    await user.click(screen.getByRole('button', { name: '月' }))
    const timeline = screen.getByRole('region', { name: '甘特时间轴' })
    expect(
      within(timeline).queryByRole('button', { name: '移动 范围前任务' }),
    ).not.toBeInTheDocument()
    expect(
      within(timeline).queryByRole('button', { name: '移动 范围后任务' }),
    ).not.toBeInTheDocument()
    expect(
      within(timeline).getByRole('button', { name: '移动 MCP 权限校验' }),
    ).toBeVisible()
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
    expect(
      screen.getByRole('status', { name: '正在加载项目数据' }),
    ).toBeVisible()
    resolveTasks([])
    expect(await screen.findByText('当前项目暂无排期任务')).toBeInTheDocument()
    loading.unmount()

    vi.spyOn(projectRepository, 'listGanttTasks').mockRejectedValueOnce(
      new Error('排期服务不可用'),
    )
    renderApp(<GanttPage />)
    expect(
      await screen.findByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('排期服务不可用')
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
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

  it('uses a synchronous lock for same-tick confirmations and releases it after settlement', async () => {
    mockTasks()
    let resolveUpdate!: (task: Task) => void
    const update = vi
      .spyOn(projectRepository, 'updateTaskDates')
      .mockImplementation(
        () =>
          new Promise<Task>((resolve) => {
            resolveUpdate = resolve
          }),
      )
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    const bar = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    bar.focus()
    await user.keyboard('{ArrowRight}')
    const confirm = screen.getByRole('button', { name: '确认排期调整' })
    act(() => {
      confirm.click()
      confirm.click()
    })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveUpdate(
        task({ startDate: '2026-07-25', dueDate: '2026-07-29' }),
      )
    })
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: '排期调整确认' }),
      ).not.toBeInTheDocument(),
    )

    bar.focus()
    await user.keyboard('{ArrowRight}')
    fireEvent.click(screen.getByRole('button', { name: '确认排期调整' }))
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

  it('restores focus to the actual timeline entry even when the task tree collapses', async () => {
    mockTasks()
    const user = userEvent.setup()
    renderApp(<GanttPage />)

    const timelineTrigger = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    await user.click(timelineTrigger)
    const dialog = screen.getByRole('dialog', { name: 'MCP 权限校验' })
    await user.click(screen.getByRole('button', { name: '折叠任务树' }))
    await user.click(
      within(dialog).getByRole('button', { name: '关闭 MCP 权限校验' }),
    )

    expect(timelineTrigger).toHaveFocus()
  })

  it('creates one pointer proposal only on completion using the final delta', async () => {
    mockTasks()
    renderApp(<GanttPage />)
    const bar = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    Object.defineProperties(bar, {
      releasePointerCapture: {
        configurable: true,
        value: vi.fn(),
      },
      setPointerCapture: {
        configurable: true,
        value: vi.fn(),
      },
    })
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 7 })
    fireEvent.pointerMove(bar, { clientX: 125, pointerId: 7 })
    expect(screen.queryByText(/MCP 权限校验：/)).not.toBeInTheDocument()

    fireEvent.pointerUp(bar, { clientX: 150, pointerId: 7 })

    expect(
      screen.getByText(
        'MCP 权限校验：7 月 24 日–7 月 28 日 → 7 月 26 日–7 月 30 日',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('status', { name: '排期调整确认' })).toHaveLength(
      1,
    )
  })

  it('cleans lost pointer capture without proposing and starts the next drag fresh', async () => {
    mockTasks()
    renderApp(<GanttPage />)
    const bar = await screen.findByRole('button', {
      name: '移动 MCP 权限校验',
    })
    const releasePointerCapture = vi.fn()
    Object.defineProperties(bar, {
      hasPointerCapture: {
        configurable: true,
        value: vi.fn(() => false),
      },
      releasePointerCapture: {
        configurable: true,
        value: releasePointerCapture,
      },
      setPointerCapture: {
        configurable: true,
        value: vi.fn(),
      },
    })

    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 7 })
    fireEvent.pointerMove(bar, { clientX: 150, pointerId: 7 })
    fireEvent.lostPointerCapture(bar, { pointerId: 7 })
    fireEvent.pointerUp(bar, { clientX: 150, pointerId: 7 })
    expect(screen.queryByText(/MCP 权限校验：/)).not.toBeInTheDocument()
    expect(releasePointerCapture).not.toHaveBeenCalled()

    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 8 })
    fireEvent.pointerMove(bar, { clientX: 125, pointerId: 8 })
    fireEvent.pointerUp(bar, { clientX: 125, pointerId: 8 })
    expect(
      screen.getByText(
        'MCP 权限校验：7 月 24 日–7 月 28 日 → 7 月 25 日–7 月 29 日',
      ),
    ).toBeInTheDocument()
  })

  it('cleans up pointer state without proposing when a drag is cancelled', async () => {
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
      await screen.findByRole('heading', { name: '甘特排程' }),
    ).toBeInTheDocument()
  })
})
