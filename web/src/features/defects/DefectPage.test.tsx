import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Defect, Requirement, Task } from '../../data/domain'
import {
  projectQueryKeys,
  projectRepository,
} from '../../data/query-hooks'
import {
  DefectPage,
  formatUpdatedAt,
  sortDefects,
} from './DefectPage'

function defect(overrides: Partial<Defect>): Defect {
  return {
    id: 'defect-default',
    code: 'D-DEFAULT',
    title: '默认缺陷',
    severity: 'normal',
    status: 'open',
    assignee: { id: 'qa-agent', name: 'qa-agent', kind: 'agent' },
    updatedAt: '2026-07-28T09:00:00+08:00',
    reproductionSteps: ['执行操作', '观察结果'],
    ...overrides,
  }
}

function renderDefectPage(cached?: {
  tasks: Task[]
  requirements: Requirement[]
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  if (cached) {
    queryClient.setQueryData(projectQueryKeys.tasks, cached.tasks)
    queryClient.setQueryData(
      projectQueryKeys.requirements,
      cached.requirements,
    )
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  )
  return {
    queryClient,
    ...render(<DefectPage />, { wrapper }),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('sortDefects', () => {
  it('formats timestamps in Hong Kong time independently of the host timezone', () => {
    expect(formatUpdatedAt('2026-07-28T02:42:00.000Z')).toBe(
      '07/28 10:42',
    )
  })

  it('orders severity, status, then latest update without mutating input', () => {
    const source = [
      defect({ id: 'normal', severity: 'normal' }),
      defect({
        id: 'fatal-old',
        severity: 'fatal',
        status: 'open',
        updatedAt: '2026-07-27T09:00:00+08:00',
      }),
      defect({
        id: 'fatal-new',
        severity: 'fatal',
        status: 'open',
        updatedAt: '2026-07-28T10:00:00+08:00',
      }),
      defect({ id: 'fatal-closed', severity: 'fatal', status: 'closed' }),
      defect({ id: 'serious', severity: 'serious', status: 'fixing' }),
      defect({ id: 'suggestion', severity: 'suggestion' }),
    ]

    expect(sortDefects(source).map((item) => item.id)).toEqual([
      'fatal-new',
      'fatal-old',
      'fatal-closed',
      'serious',
      'normal',
      'suggestion',
    ])
    expect(source.map((item) => item.id)).toEqual([
      'normal',
      'fatal-old',
      'fatal-new',
      'fatal-closed',
      'serious',
      'suggestion',
    ])
  })

  it('is stable for equal keys and safely places unknown runtime values last', () => {
    const source = [
      defect({ id: 'tie-a' }),
      defect({ id: 'tie-b' }),
      defect({
        id: 'unknown',
        severity: 'mystery' as Defect['severity'],
        status: 'lost' as Defect['status'],
      }),
    ]

    expect(sortDefects(source).map((item) => item.id)).toEqual([
      'tie-a',
      'tie-b',
      'unknown',
    ])
  })
})

describe('DefectPage workflow', () => {
  it('renders a semantic severity by status matrix from real defect fields', async () => {
    renderApp(<AppRoutes />, { route: '/defects' })

    expect(await screen.findByRole('heading', { name: '缺陷矩阵' }))
      .toBeVisible()
    const matrix = screen.getByRole('table', {
      name: '缺陷严重度与状态矩阵',
    })
    expect(within(matrix).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual([
        '严重度 / 状态',
        '待处理',
        '修复中',
        '验证中',
        '已关闭',
        '已驳回',
        '非缺陷',
      ])
    expect(within(matrix).getAllByRole('rowheader').map((cell) => cell.textContent))
      .toEqual(['致命', '严重', '一般', '建议'])
    const fatalOpen = within(matrix).getByRole('cell', {
      name: '致命 · 待处理',
    })
    expect(within(fatalOpen).getByRole('button', {
      name: '查看 离线恢复失败',
    })).toBeVisible()
  })

  it('uses severity tones and synchronizes matrix selection with the inspector', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    const fatal = await screen.findByRole('button', {
      name: '查看 离线恢复失败',
    })
    const serious = screen.getByRole('button', {
      name: '查看 待处理缺陷 1',
    })
    const normal = screen.getByRole('button', {
      name: '查看 甘特图标签截断',
    })
    const suggestion = screen.getByRole('button', {
      name: '查看 待处理缺陷 2',
    })
    expect(fatal).toHaveClass('defect-matrix__card--critical')
    expect(serious).toHaveClass('defect-matrix__card--critical')
    expect(normal).toHaveClass('defect-matrix__card--warning')
    expect(suggestion).toHaveClass('defect-matrix__card--silver')

    await user.click(fatal)
    expect(fatal).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: '离线恢复失败' })).toBeVisible()
  })

  it('shows compact status summaries and explicit all/active scope', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await screen.findByRole('table', { name: '缺陷严重度与状态矩阵' })
    const summary = document.querySelector('.defect-summary') as HTMLElement
    expect(within(summary).getByText('致命/严重')).toBeVisible()
    expect(within(summary).getByText('待处理')).toBeVisible()
    expect(within(summary).getByText('修复中')).toBeVisible()
    expect(within(summary).getByText('验证中')).toBeVisible()
    expect(screen.getByRole('button', { name: '全部缺陷' }))
      .toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '活跃缺陷' }))
    expect(screen.getByRole('button', { name: '活跃缺陷' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('recalculates summary counts from the current active scope', async () => {
    const existing = await projectRepository.listDefects('atlas')
    const terminalSerious = defect({
      id: 'defect-terminal-serious',
      code: 'D-TERMINAL',
      title: '已关闭严重缺陷',
      severity: 'serious',
      status: 'closed',
    })
    vi.spyOn(projectRepository, 'listDefects').mockResolvedValueOnce([
      ...existing,
      terminalSerious,
    ])
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await screen.findByRole('table', { name: '缺陷严重度与状态矩阵' })
    const summary = document.querySelector('.defect-summary') as HTMLElement
    const severeLabel = within(summary).getByText('致命/严重')
    expect(severeLabel.nextElementSibling).toHaveTextContent('3')
    expect(
      screen.getByRole('button', { name: '查看 已关闭严重缺陷' }),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: '活跃缺陷' }))

    expect(severeLabel.nextElementSibling).toHaveTextContent('2')
    expect(
      screen.queryByRole('button', { name: '查看 已关闭严重缺陷' }),
    ).not.toBeInTheDocument()
  })

  it('toggles an expanded inspector and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    const trigger = await screen.findByRole('button', {
      name: '查看 离线恢复失败',
    })
    expect(trigger).toHaveAttribute('id', 'defect-trigger-defect-104')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute(
      'aria-controls',
      'defect-inspector-defect-104',
    )
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '离线恢复失败' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('defect-inspector-defect-104')).toContainElement(
      dialog,
    )
    expect(within(dialog).getByRole('list')).toHaveTextContent('重新启动客户端')
    expect(within(dialog).getByText(/TASK-047/)).toBeVisible()
    expect(within(dialog).getByText(/REQ-013/)).toBeVisible()
    expect(within(dialog).getByText('暂无附件')).toBeVisible()
    expect(within(dialog).getByText('暂无相关活动')).toBeVisible()

    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('does not leak a pending conversion or its eventual task into another defect', async () => {
    let resolveConversion: (() => void) | undefined
    const original = projectRepository.createTaskFromDefect.bind(projectRepository)
    vi.spyOn(projectRepository, 'createTaskFromDefect').mockImplementationOnce(
      (defectId) =>
        new Promise<void>((resolve) => {
          resolveConversion = resolve
        }).then(() => original(defectId)),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await user.click(
      await screen.findByRole('button', { name: '查看 待处理缺陷 1' }),
    )
    const firstDialog = screen.getByRole('dialog', { name: '待处理缺陷 1' })
    await user.click(
      within(firstDialog).getByRole('button', { name: '转为修复任务' }),
    )
    expect(
      within(firstDialog).getByRole('button', { name: /正在创建/ }),
    ).toBeDisabled()

    await user.click(
      screen.getByRole('button', { name: '查看 待处理缺陷 2' }),
    )
    const secondDialog = screen.getByRole('dialog', { name: '待处理缺陷 2' })
    expect(
      within(secondDialog).getByRole('button', { name: '转为修复任务' }),
    ).toBeEnabled()
    expect(within(secondDialog).queryByRole('alert')).not.toBeInTheDocument()

    resolveConversion?.()
    await screen.findByRole('dialog', { name: '待处理缺陷 2' })
    expect(
      within(secondDialog).queryByRole('link', { name: /FIX-D-200/ }),
    ).not.toBeInTheDocument()
  })

  it('does not leak a conversion error after selecting another defect', async () => {
    vi.spyOn(projectRepository, 'createTaskFromDefect').mockRejectedValueOnce(
      new Error('A 缺陷转换失败'),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await user.click(
      await screen.findByRole('button', { name: '查看 待处理缺陷 3' }),
    )
    const firstDialog = screen.getByRole('dialog', { name: '待处理缺陷 3' })
    await user.click(
      within(firstDialog).getByRole('button', { name: '转为修复任务' }),
    )
    expect(await within(firstDialog).findByRole('alert')).toHaveTextContent(
      'A 缺陷转换失败',
    )

    await user.click(
      screen.getByRole('button', { name: '查看 待处理缺陷 4' }),
    )
    const secondDialog = screen.getByRole('dialog', { name: '待处理缺陷 4' })
    expect(within(secondDialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(
      within(secondDialog).getByRole('button', { name: '转为修复任务' }),
    ).toBeEnabled()
  })

  it('disables conversion while pending and exposes the created task link', async () => {
    let resolveTask:
      | ((task: Awaited<ReturnType<typeof projectRepository.createTaskFromDefect>>) => void)
      | undefined
    const original = projectRepository.createTaskFromDefect.bind(projectRepository)
    vi.spyOn(projectRepository, 'createTaskFromDefect').mockImplementationOnce(
      (defectId) =>
        new Promise((resolve) => {
          resolveTask = resolve
        }).then(() => original(defectId)),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await user.click(
      await screen.findByRole('button', { name: '查看 离线恢复失败' }),
    )
    const dialog = screen.getByRole('dialog', { name: '离线恢复失败' })
    const conversion = within(dialog).getByRole('button', {
      name: '转为修复任务',
    })
    await user.click(conversion)
    expect(conversion).toBeDisabled()
    expect(conversion).toHaveTextContent('正在创建')

    resolveTask?.({} as never)
    const link = await within(dialog).findByRole('link', {
      name: /FIX-D-104 修复：离线恢复失败/,
    })
    expect(link).toHaveAttribute(
      'href',
      '/tasks?selected=task-fix-defect-104',
    )
    expect(within(dialog).getAllByText(/FIX-D-104/)).toHaveLength(2)

    await user.click(link)
    const taskDialog = await screen.findByRole('dialog', {
      name: '修复：离线恢复失败',
    })
    expect(within(taskDialog).getByText('FIX-D-104')).toBeVisible()
    expect(within(taskDialog).getByText('重新启动客户端', { exact: false }))
      .toBeVisible()
  })

  it('retains the inspector and reports conversion errors', async () => {
    vi.spyOn(projectRepository, 'createTaskFromDefect').mockRejectedValueOnce(
      new Error('转换服务暂不可用'),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await user.click(
      await screen.findByRole('button', { name: '查看 甘特图标签截断' }),
    )
    const dialog = screen.getByRole('dialog', { name: '甘特图标签截断' })
    await user.click(
      within(dialog).getByRole('button', { name: '转为修复任务' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '转换服务暂不可用',
    )
    expect(dialog).toBeVisible()
  })

  it('renders loading, error, and empty query states', async () => {
    const pending = new Promise<Defect[]>(() => undefined)
    vi.spyOn(projectRepository, 'listDefects').mockReturnValueOnce(pending)
    const loading = renderApp(<AppRoutes />, { route: '/defects' })
    expect(
      await screen.findByRole('status', { name: '正在加载项目数据' }),
    ).toBeVisible()
    loading.unmount()

    vi.spyOn(projectRepository, 'listDefects').mockRejectedValueOnce(
      new Error('缺陷数据不可用'),
    )
    const error = renderApp(<AppRoutes />, { route: '/defects' })
    expect(
      await screen.findByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('缺陷数据不可用')
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
    error.unmount()

    vi.spyOn(projectRepository, 'listDefects').mockResolvedValueOnce([])
    renderApp(<AppRoutes />, { route: '/defects' })
    expect(await screen.findByText('当前项目暂无缺陷')).toBeVisible()
  })

  it('keeps the main defect table while linked work is pending without reporting none', async () => {
    vi.spyOn(projectRepository, 'listTasks').mockImplementationOnce(
      () => new Promise(() => {}),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    expect(
      await screen.findByRole('table', { name: '缺陷严重度与状态矩阵' }),
    ).toBeVisible()
    expect(
      screen.getByRole('status', { name: '正在加载关联工作' }),
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: '查看 离线恢复失败' }),
    )
    const dialog = screen.getByRole('dialog', { name: '离线恢复失败' })
    expect(within(dialog).getByText('任务：正在加载关联任务')).toBeVisible()
    expect(within(dialog).queryByText(/暂无关联任务/)).not.toBeInTheDocument()
  })

  it('shows secondary query reasons and retries without replacing defect content', async () => {
    const listTasks = vi.spyOn(projectRepository, 'listTasks')
      .mockRejectedValueOnce(new Error('关联任务数据库不可访问'))
      .mockResolvedValueOnce([])
    const listRequirements = vi.spyOn(projectRepository, 'listRequirements')
      .mockRejectedValueOnce(new Error('关联需求数据库不可访问'))
      .mockResolvedValueOnce([])
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    expect(
      await screen.findByRole('table', { name: '缺陷严重度与状态矩阵' }),
    ).toBeVisible()
    expect(screen.getByText('关联任务数据库不可访问')).toBeVisible()
    expect(screen.getByText('关联需求数据库不可访问')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: '查看 离线恢复失败' }),
    )
    const dialog = screen.getByRole('dialog', { name: '离线恢复失败' })
    expect(within(dialog).getByText('任务：关联任务读取失败')).toBeVisible()
    expect(within(dialog).getByText('需求：关联需求读取失败')).toBeVisible()
    expect(within(dialog).queryByText(/暂无关联/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试关联任务' }))
    await user.click(screen.getByRole('button', { name: '重试关联需求' }))
    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(listRequirements).toHaveBeenCalledTimes(2)
    expect(
      await within(dialog).findByText('任务：暂无关联任务'),
    ).toBeVisible()
    expect(
      await within(dialog).findByText('需求：暂无关联需求'),
    ).toBeVisible()
    expect(
      screen.getByRole('table', { name: '缺陷严重度与状态矩阵' }),
    ).toBeVisible()
  })

  it('merges cached secondary refresh failures into one nonblocking warning', async () => {
    const cachedTasks = await projectRepository.listTasks('atlas')
    const cachedRequirements = await projectRepository.listRequirements(
      'atlas',
    )
    const listTasks = vi.spyOn(projectRepository, 'listTasks')
      .mockRejectedValueOnce(new Error('关联任务刷新失败'))
      .mockResolvedValueOnce(cachedTasks)
    const listRequirements = vi.spyOn(projectRepository, 'listRequirements')
      .mockRejectedValueOnce(new Error('关联需求刷新失败'))
      .mockResolvedValueOnce(cachedRequirements)
    const user = userEvent.setup()
    renderDefectPage({
      tasks: cachedTasks,
      requirements: cachedRequirements,
    })

    expect(
      await screen.findByRole('table', { name: '缺陷严重度与状态矩阵' }),
    ).toBeVisible()
    const warning = await screen.findByRole('status', {
      name: '关联数据刷新失败',
    })
    await user.click(
      screen.getByRole('button', { name: '查看 离线恢复失败' }),
    )
    const dialog = screen.getByRole('dialog', { name: '离线恢复失败' })
    expect(within(dialog).getByText(/TASK-047/)).toBeVisible()
    expect(within(dialog).getByText(/REQ-013/)).toBeVisible()

    expect(warning).toHaveTextContent(
      '关联数据刷新失败，正在显示上次数据',
    )
    expect(warning).toHaveTextContent('关联任务、关联需求')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/TASK-047/)).toBeVisible()
    expect(within(dialog).getByText(/REQ-013/)).toBeVisible()
    expect(within(dialog).getAllByText('上次数据').length).toBeGreaterThan(0)

    await user.click(
      within(warning).getByRole('button', { name: '重试关联任务' }),
    )
    await user.click(
      within(warning).getByRole('button', { name: '重试关联需求' }),
    )
    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(listRequirements).toHaveBeenCalledTimes(2)
    expect(
      screen.getByRole('table', { name: '缺陷严重度与状态矩阵' }),
    ).toBeVisible()
  })
})
