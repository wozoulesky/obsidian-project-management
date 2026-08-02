import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Task } from '../../data/domain'
import { createFixtureSeed } from '../../data/fixtures'
import {
  projectQueryKeys,
  projectRepository,
} from '../../data/query-hooks'
import { filterTasks } from './TaskFilters'
import { TaskInspector } from './TaskInspector'
import { TaskPage } from './TaskPage'
import { TaskTable } from './TaskTable'
import tasksGlassCss from './tasks-glass.css?raw'

const fixtureTasks = createFixtureSeed().tasks

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 3) }, (_, index) => ({
        index,
        start: index * 44,
      })),
    measureElement: vi.fn(),
  }),
}))

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-default',
    code: 'TASK-DEFAULT',
    title: '默认任务',
    description: '测试任务',
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

function renderTaskPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  )
  return {
    queryClient,
    ...render(<TaskPage />, { wrapper }),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
})

describe('filterTasks', () => {
  it('combines validated status, assignee, and priority filters', () => {
    const result = filterTasks(fixtureTasks, new URLSearchParams({
      status: 'in_progress',
      assignee: 'human-lin',
      priority: 'P0',
    }))

    expect(result.map((item) => item.title)).toEqual(['MCP 权限校验'])
  })

  it('sorts due dates descending without mutating the source', () => {
    const first = task({ id: 'first', title: '先', dueDate: '2026-07-20' })
    const second = task({ id: 'second', title: '后', dueDate: '2026-07-30' })
    const source = [first, second]

    const result = filterTasks(source, new URLSearchParams('sort=due_desc'))

    expect(result.map((item) => item.id)).toEqual(['second', 'first'])
    expect(source.map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('defaults to a stable ascending due-date sort', () => {
    const source = [
      task({ id: 'later', dueDate: '2026-07-30' }),
      task({ id: 'tie-a', dueDate: '2026-07-20' }),
      task({ id: 'tie-b', dueDate: '2026-07-20' }),
    ]

    expect(filterTasks(source, new URLSearchParams()).map((item) => item.id))
      .toEqual(['tie-a', 'tie-b', 'later'])
  })

  it('ignores unknown enum and sort values safely', () => {
    const malicious = new URLSearchParams({
      status: '__proto__',
      priority: '<script>',
      sort: 'drop table tasks',
    })

    expect(() => filterTasks(fixtureTasks, malicious)).not.toThrow()
    expect(filterTasks(fixtureTasks, malicious)).toHaveLength(fixtureTasks.length)
    expect(filterTasks(fixtureTasks, malicious)[0]?.dueDate)
      .toBe('2026-07-23')
  })
})

describe('TaskPage workflow', () => {
  it('renders list, fan and persistent context before the independent timeline', async () => {
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'done-early',
        code: 'TASK-DONE',
        title: '已完成早期任务',
        dueDate: '2026-07-01',
        priority: 'P3',
        status: 'done',
      }),
      task({
        id: 'overdue-p0',
        code: 'TASK-RISK',
        title: '首要风险任务',
        dueDate: '2026-07-30',
        priority: 'P0',
        status: 'overdue',
      }),
    ])
    const { container } = renderApp(<TaskPage />)

    const workspace = await screen.findByTestId('task-workspace')
    expect(
      Array.from(workspace.children).map((node) =>
        node.getAttribute('data-slot'),
      ),
    ).toEqual(['list', 'fan', 'context'])
    expect(
      within(workspace).getByRole('region', { name: '任务列表' }),
    ).toBeVisible()
    expect(
      within(workspace).getByRole('region', { name: '关键任务扇面' }),
    ).toBeVisible()
    const context = within(workspace).getByRole('region', {
      name: '智能任务上下文',
    })
    expect(context).toHaveTextContent('首要风险任务')
    const synchronizedTriggers = within(workspace).getAllByRole('button', {
      name: /首要风险任务/,
    })
    expect(synchronizedTriggers).toHaveLength(2)
    synchronizedTriggers.forEach((trigger) => {
      expect(trigger).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).not.toContain('selected=')

    const timeline = screen.getByRole('region', { name: '独立交付时间线' })
    expect(timeline).toBe(container.querySelector('.task-workspace')?.nextElementSibling)
  })

  it('uses the shared glass header and derives four metrics from task data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 28, 12))
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'today',
        code: 'TASK-TODAY',
        title: '今日交付',
        dueDate: '2026-07-28',
        status: 'not_started',
        progress: 0,
      }),
      task({
        id: 'active',
        code: 'TASK-ACTIVE',
        title: '持续推进',
        dueDate: '2026-07-30',
      }),
      task({
        id: 'done',
        code: 'TASK-DONE',
        title: '完成交付',
        status: 'done',
        progress: 100,
      }),
      task({
        id: 'overdue',
        code: 'TASK-OVERDUE',
        title: '风险任务',
        status: 'overdue',
      }),
    ])
    const { container } = renderApp(<TaskPage />)

    expect(
      await screen.findByRole('heading', { name: '任务控制台' }),
    ).toBeVisible()
    expect(container.querySelector('.page-header')).toBeInTheDocument()
    const metrics = screen.getByRole('group', { name: '任务关键指标' })
    expect(metrics).toHaveClass('metric-grid')
    const values = Object.fromEntries(
      Array.from(metrics.querySelectorAll<HTMLElement>('[data-metric]')).map(
        (metric) => [
          metric.dataset.metric,
          within(metric).getByTestId('metric-value').textContent,
        ],
      ),
    )
    expect(values).toEqual({
      今日待办: '1',
      进行中: '1',
      已完成: '1',
      逾期: '1',
    })
    expect(metrics.querySelectorAll('.glass-panel')).toHaveLength(4)
  })

  it('derives today tasks from the current local business date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 28, 12))
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'july-28',
        code: 'TASK-JULY-28',
        title: '七月二十八日任务',
        dueDate: '2026-07-28',
        status: 'not_started',
        progress: 0,
      }),
      task({
        id: 'july-29-a',
        code: 'TASK-JULY-29-A',
        title: '七月二十九日任务一',
        dueDate: '2026-07-29',
        status: 'not_started',
        progress: 0,
      }),
      task({
        id: 'july-29-b',
        code: 'TASK-JULY-29-B',
        title: '七月二十九日任务二',
        dueDate: '2026-07-29',
        status: 'in_progress',
      }),
    ])
    const { rerender } = renderApp(<TaskPage />)

    await screen.findByRole('heading', { name: '任务控制台' })
    const todayValue = () => {
      const metric = screen.getByText('今日待办').closest('[data-metric]')
      expect(metric).not.toBeNull()
      return within(metric as HTMLElement).getByTestId('metric-value')
    }
    expect(todayValue()).toHaveTextContent('1')
    expect(screen.getByText(/以 2026-07-28 为今日基准/)).toBeVisible()

    vi.setSystemTime(new Date(2026, 6, 29, 12))
    rerender(<TaskPage />)

    expect(todayValue()).toHaveTextContent('2')
    expect(screen.getByText(/以 2026-07-29 为今日基准/)).toBeVisible()
  })

  it('keeps the complete filtered compact list beside the six-card fan', async () => {
    renderApp(<TaskPage />)

    const fan = await screen.findByRole('region', { name: '关键任务扇面' })
    expect(within(fan).getAllByRole('button')).toHaveLength(6)
    const list = screen.getByRole('region', { name: '任务列表' })
    expect(
      within(list).getByRole('button', { name: '查看 甘特图渲染' }),
    ).toBeVisible()
    expect(within(list).getAllByRole('button', { name: /^查看 / }))
      .toHaveLength(fixtureTasks.length)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('links a fan selection through the URL, list, and persistent context', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?priority=P0&sort=due_desc',
    })

    const fanTrigger = await screen.findByRole('button', {
      name: '选择 TASK-047 断线恢复测试',
    })
    await user.click(fanTrigger)

    expect(window.location.search).toContain('priority=P0')
    expect(window.location.search).toContain('sort=due_desc')
    expect(window.location.search).toContain('selected=task-047')
    expect(fanTrigger).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '查看 断线恢复测试' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps timeline range local and writes timeline selection without dropping filters', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?priority=P1&sort=due_desc',
    })

    const workspace = await screen.findByTestId('task-workspace')
    const listCount = within(workspace).getAllByRole('button', {
      name: /^查看 /,
    }).length
    const context = within(workspace).getByRole('region', {
      name: '智能任务上下文',
    })
    const initialContext = context.textContent
    const timeline = screen.getByRole('region', { name: '独立交付时间线' })

    await user.click(within(timeline).getByRole('button', { name: '季度' }))

    expect(window.location.search).toBe('?priority=P1&sort=due_desc')
    expect(within(workspace).getAllByRole('button', { name: /^查看 / }))
      .toHaveLength(listCount)
    expect(context.textContent).toBe(initialContext)

    await user.click(within(timeline).getByRole('button', {
      name: '选择 TASK-063 甘特图渲染',
    }))
    expect(window.location.search).toContain('priority=P1')
    expect(window.location.search).toContain('sort=due_desc')
    expect(window.location.search).toContain('selected=task-063')
    expect(context).toHaveTextContent('甘特图渲染')
  })

  it('keeps focus on the fan trigger without opening an inspector dialog', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?priority=P0&sort=due_desc',
    })

    const fanTrigger = await screen.findByRole('button', {
      name: '选择 TASK-047 断线恢复测试',
    })
    expect(fanTrigger).toHaveAttribute('id', 'task-fan-trigger-task-047')
    await user.click(fanTrigger)

    expect(fanTrigger).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps page width bounded while signature regions own their scrolling', () => {
    expect(tasksGlassCss).toMatch(
      /\.task-page\s*{[^}]*overflow-x:\s*clip/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-fan__scroll,[^}]*\.delivery-timeline__scroll\s*{[^}]*overflow-x:\s*auto/s,
    )
  })

  it('uses shared loading, error with retry, and empty states', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'listTasks').mockImplementationOnce(
      () => new Promise(() => {}),
    )
    const loading = renderApp(<AppRoutes />, { route: '/tasks' })
    expect(
      await screen.findByRole('status', { name: '正在加载项目数据' }),
    ).toBeVisible()
    loading.unmount()

    const listTasks = vi.spyOn(projectRepository, 'listTasks')
    listTasks.mockReset()
      .mockRejectedValueOnce(new Error('数据库文件不可访问'))
      .mockResolvedValueOnce([])
    const error = renderApp(<AppRoutes />, { route: '/tasks' })
    expect(
      await screen.findByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('当前项目暂无任务')).toBeVisible()
    error.unmount()
  })

  it('retains task content while a background refresh is pending', async () => {
    vi.spyOn(projectRepository, 'listTasks')
      .mockResolvedValueOnce(fixtureTasks)
      .mockImplementationOnce(() => new Promise(() => {}))
    const { queryClient } = renderTaskPage()

    await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    act(() => {
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks })
    })

    expect(
      await screen.findByRole('status', { name: '正在刷新项目数据' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
  })

  it('retains task content and warns when a background refresh fails', async () => {
    vi.spyOn(projectRepository, 'listTasks')
      .mockResolvedValueOnce(fixtureTasks)
      .mockRejectedValueOnce(new Error('数据库文件不可访问'))
    const { queryClient } = renderTaskPage()

    await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '刷新失败，正在显示上次数据。数据库文件不可访问',
    )
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
  })

  it('shows a valid visible task from the selected query parameter in context', async () => {
    renderApp(<AppRoutes />, {
      route: '/tasks?selected=task-047',
    })

    const context = await screen.findByRole('region', {
      name: '智能任务上下文',
    })
    expect(within(context).getByText('TASK-047')).toBeVisible()
    expect(context).toHaveTextContent('断线恢复测试')
    expect(
      screen.getByRole('button', { name: '查看 断线恢复测试' }),
    ).toBeVisible()
  })

  it('falls back from missing, invalid, and filter-hidden selections', async () => {
    const missing = renderApp(<AppRoutes />, {
      route: '/tasks?selected=missing-task',
    })
    expect(await screen.findByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    missing.unmount()

    const hidden = renderApp(<AppRoutes />, {
      route: '/tasks?status=done&selected=task-047',
    })
    expect(await screen.findByRole('region', { name: '智能任务上下文' }))
      .not.toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    hidden.unmount()

    renderApp(<AppRoutes />, {
      route: '/tasks?selected=%3Cscript%3E',
    })
    expect(await screen.findByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stores compact-list selection in the URL without dropping filters', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, {
      route: '/tasks?priority=P0&sort=due_desc',
    })

    const listTrigger = await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    expect(listTrigger).toHaveAttribute('id', 'task-list-trigger-task-051')
    await user.click(listTrigger)
    expect(window.location.search).toContain('priority=P0')
    expect(window.location.search).toContain('sort=due_desc')
    expect(window.location.search).toContain('selected=task-051')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('MCP 权限校验')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('writes the overdue filter to the URL and only shows overdue work', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await screen.findByRole('button', { name: '查看 断线恢复测试' })
    await user.click(screen.getByRole('button', { name: '已延期' }))

    expect(window.location.search).toContain('status=overdue')
    expect(screen.getByRole('button', { name: '查看 断线恢复测试' }))
      .toBeVisible()
    expect(screen.queryByRole('button', { name: '查看 甘特图渲染' }))
      .not.toBeInTheDocument()
  })

  it('toggles the overdue filter off and restores the full result', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await screen.findByRole('button', { name: '查看 MCP 权限校验' })
    const overdue = screen.getByRole('button', { name: '已延期' })
    await user.click(overdue)
    expect(overdue).toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toContain('status=overdue')

    await user.click(overdue)

    expect(window.location.search).not.toContain('status=')
    expect(overdue).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '查看 甘特图渲染' }),
    ).toBeVisible()
  })

  it('falls back to visible persistent context when a filter hides selection', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('MCP 权限校验')

    await user.click(screen.getByRole('button', { name: '已延期' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).not.toContain('selected=')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')

    await user.click(screen.getByRole('button', { name: '已延期' }))
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates MCP permission validation to 80 percent', async () => {
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const progress = within(context).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '80')
    await user.click(within(context).getByRole('button', { name: '提交进度' }))

    await waitFor(() => expect(updateProgress).toHaveBeenCalledWith(
      'task-051',
      expect.objectContaining({ progress: 80 }),
    ))
    expect(progress).toHaveValue(80)
  })

  it('rejects non-integer progress and retains the entered value', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const progress = within(context).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '80.5')
    await user.click(within(context).getByRole('button', { name: '提交进度' }))

    expect(within(context).getByRole('alert')).toHaveTextContent('0 到 100 的整数')
    expect(progress).toHaveValue(80.5)
  })

  it('retains form values when the update fails', async () => {
    vi.spyOn(projectRepository, 'updateTaskProgress').mockRejectedValueOnce(
      new Error('网络暂时不可用'),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const progress = within(context).getByRole('spinbutton', {
      name: '任务进度',
    })
    const note = within(context).getByRole('textbox', { name: '进度备注' })
    await user.clear(progress)
    await user.type(progress, '80')
    await user.type(note, '等待服务恢复')
    await user.click(within(context).getByRole('button', { name: '提交进度' }))

    expect(await within(context).findByRole('alert')).toHaveTextContent(
      '网络暂时不可用',
    )
    expect(progress).toHaveValue(80)
    expect(note).toHaveValue('等待服务恢复')
  })

  it('resets the controlled form when the selected task changes', async () => {
    const user = userEvent.setup()
    const firstTask = task({
      id: 'first',
      title: '第一项任务',
      progress: 45,
      status: 'in_progress',
    })
    const secondTask = task({
      id: 'second',
      title: '第二项任务',
      progress: 10,
      status: 'not_started',
    })
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={firstTask} />,
    )

    const firstDialog = screen.getByRole('dialog', { name: '第一项任务' })
    const firstProgress = within(firstDialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(firstProgress)
    await user.type(firstProgress, '90')
    await user.type(
      within(firstDialog).getByRole('textbox', { name: '进度备注' }),
      '第一项备注',
    )

    rerender(<TaskInspector onClose={vi.fn()} task={secondTask} />)

    const secondDialog = screen.getByRole('dialog', { name: '第二项任务' })
    expect(
      within(secondDialog).getByRole('spinbutton', { name: '任务进度' }),
    ).toHaveValue(10)
    expect(
      within(secondDialog).getByRole('combobox', { name: '状态' }),
    ).toHaveValue('not_started')
    expect(
      within(secondDialog).getByRole('textbox', { name: '进度备注' }),
    ).toHaveValue('')
  })

  it('switches the persistent form to the latest compact-list selection', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    const firstTrigger = await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    await user.click(firstTrigger)
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('MCP 权限校验')

    const latestTrigger = screen.getByRole('button', {
      name: '查看 断线恢复测试',
    })
    await user.click(latestTrigger)

    const latestContext = screen.getByRole('region', {
      name: '智能任务上下文',
    })
    expect(
      within(latestContext).getByRole('spinbutton', { name: '任务进度' }),
    ).toHaveValue(45)
    expect(latestTrigger).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses the shared six-column grid in the virtual table branch', () => {
    const virtualTasks = Array.from({ length: 101 }, (_, index) =>
      task({
        id: `virtual-${index}`,
        code: `VIRTUAL-${index}`,
        title: `虚拟任务 ${index}`,
      }),
    )
    const { container } = renderApp(
      <TaskTable
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={virtualTasks}
      />,
    )

    const table = screen.getByRole('table', { name: '任务列表' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(6)
    expect(within(table).getAllByRole('row')[0]).toHaveClass(
      'task-table__grid-row',
    )
    const virtualBody = container.querySelector(
      '.task-table__virtual-body',
    )
    expect(virtualBody).toBeInTheDocument()
    const renderedRows = within(virtualBody as HTMLElement).getAllByRole('row')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows[0]).toHaveClass('task-table__grid-row')
    expect(within(renderedRows[0]!).getAllByRole('cell')).toHaveLength(6)
  })

  it('virtualizes at exactly 100 tasks but not at 99', () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      task({
        id: `threshold-${index}`,
        code: `THRESHOLD-${index}`,
        title: `阈值任务 ${index}`,
      }),
    )
    const belowThreshold = renderApp(
      <TaskTable
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={tasks.slice(0, 99)}
      />,
    )

    expect(
      belowThreshold.container.querySelector('.task-table__virtual-body'),
    ).not.toBeInTheDocument()
    belowThreshold.unmount()

    const atThreshold = renderApp(
      <TaskTable
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={tasks}
      />,
    )
    expect(
      atThreshold.container.querySelector('.task-table__virtual-body'),
    ).toBeInTheDocument()
  })
})
