import {
  cleanup,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Defect } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import {
  DefectPage,
  formatUpdatedAt,
  sortDefects,
} from './DefectPage'
import defectGlassCss from './defects-glass.css?raw'

function defect(overrides: Partial<Defect>): Defect {
  return {
    id: 'defect-default',
    code: 'D-DEFAULT',
    title: '默认缺陷',
    severity: 'normal',
    status: 'open',
    assignee: { id: 'qa-agent', name: 'qa-agent', kind: 'agent' },
    createdAt: '2026-07-27T09:00:00+08:00',
    updatedAt: '2026-07-28T09:00:00+08:00',
    reproductionSteps: ['执行操作', '观察结果'],
    ...overrides,
  }
}

const stageFixtures: Defect[] = [
  defect({
    id: 'fatal-open',
    code: 'D-FATAL',
    title: '致命待处理',
    severity: 'fatal',
    status: 'open',
    createdAt: '2026-07-20T09:00:00+08:00',
  }),
  defect({
    id: 'serious-fixing',
    code: 'D-FIXING',
    title: '严重修复中',
    severity: 'serious',
    status: 'fixing',
  }),
  defect({
    id: 'normal-verifying',
    code: 'D-VERIFYING',
    title: '一般验证中',
    severity: 'normal',
    status: 'verifying',
  }),
  defect({
    id: 'normal-closed',
    code: 'D-CLOSED',
    title: '一般已关闭',
    severity: 'normal',
    status: 'closed',
  }),
  defect({
    id: 'suggestion-rejected',
    code: 'D-REJECTED',
    title: '建议已驳回',
    severity: 'suggestion',
    status: 'rejected',
  }),
  defect({
    id: 'suggestion-not-defect',
    code: 'D-NOT',
    title: '建议非缺陷',
    severity: 'suggestion',
    status: 'not_a_defect',
  }),
]

function renderWithDefects(defects: Defect[]) {
  vi.spyOn(projectRepository, 'listDefects').mockResolvedValueOnce(defects)
  return renderApp(<DefectPage />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('defect triage ordering', () => {
  it('formats timestamps in Hong Kong time independently of the host timezone', () => {
    expect(formatUpdatedAt('2026-07-28T02:42:00.000Z')).toBe('07/28 10:42')
  })

  it('orders severity, status, creation time, then id without mutating input', () => {
    const source = [
      defect({ id: 'normal', severity: 'normal' }),
      defect({
        id: 'fatal-new',
        severity: 'fatal',
        createdAt: '2026-07-22T09:00:00+08:00',
      }),
      defect({
        id: 'fatal-old-b',
        severity: 'fatal',
        createdAt: '2026-07-20T09:00:00+08:00',
      }),
      defect({
        id: 'fatal-old-a',
        severity: 'fatal',
        createdAt: '2026-07-20T09:00:00+08:00',
      }),
      defect({ id: 'fatal-closed', severity: 'fatal', status: 'closed' }),
    ]

    expect(sortDefects(source).map(({ id }) => id)).toEqual([
      'fatal-old-a',
      'fatal-old-b',
      'fatal-new',
      'fatal-closed',
      'normal',
    ])
    expect(source[0]?.id).toBe('normal')
  })
})

describe('DefectPage approved triage workspace', () => {
  it('maps six real statuses into a compact four-by-three matrix', async () => {
    renderWithDefects(stageFixtures)

    const matrix = await screen.findByRole('table', {
      name: '缺陷严重度与处理阶段矩阵',
    })
    expect(within(matrix).getAllByRole('columnheader').map(({ textContent }) =>
      textContent,
    )).toEqual(['严重度 / 处理阶段', '待处理', '修复中', '已解决'])
    expect(within(matrix).getAllByRole('rowheader').map(({ textContent }) =>
      textContent,
    )).toEqual(['致命', '严重', '一般', '建议'])

    expect(within(within(matrix).getByRole('cell', {
      name: '致命 · 待处理',
    })).getByRole('button', { name: '查看 致命待处理' })).toBeVisible()
    expect(within(within(matrix).getByRole('cell', {
      name: '一般 · 修复中',
    })).getByRole('button', { name: '查看 一般验证中' })).toBeVisible()
    const resolved = within(matrix).getByRole('cell', { name: '建议 · 已解决' })
    expect(within(resolved).getByRole('button', { name: '查看 建议已驳回' }))
      .toBeVisible()
    expect(within(resolved).getByRole('button', { name: '查看 建议非缺陷' }))
      .toBeVisible()
  })

  it('renders four honest metrics and no invented impact copy', async () => {
    renderWithDefects(stageFixtures)

    const metrics = await screen.findByRole('group', { name: '缺陷矩阵指标' })
    expect(within(metrics).getAllByRole('article')).toHaveLength(4)
    expect(within(metrics).getByText('致命/严重').nextElementSibling)
      .toHaveTextContent('2')
    expect(within(metrics).getByText('待处理').nextElementSibling)
      .toHaveTextContent('1')
    expect(within(metrics).getByText('修复中').nextElementSibling)
      .toHaveTextContent('2')
    expect(within(metrics).getByText('已解决').nextElementSibling)
      .toHaveTextContent('3')
    expect(screen.queryByText(/^影响$/)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('影响版本')
    expect(document.body).not.toHaveTextContent('高影响')
  })

  it('selects the highest-priority visible defect by default without a dialog', async () => {
    renderWithDefects([...stageFixtures].reverse())

    const context = await screen.findByRole('complementary', {
      name: '缺陷上下文',
    })
    expect(within(context).getByRole('heading', { name: '致命待处理' }))
      .toBeVisible()
    expect(within(context).getByText('D-FATAL')).toBeVisible()
    expect(screen.getByRole('button', { name: '查看 致命待处理' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('synchronizes matrix and top-three triage selection with context', async () => {
    const user = userEvent.setup()
    renderWithDefects(stageFixtures)

    const context = await screen.findByRole('complementary', {
      name: '缺陷上下文',
    })
    const queue = screen.getByRole('region', { name: '优先分诊队列' })
    expect(within(queue).getAllByRole('button')).toHaveLength(3)

    const matrixButton = screen.getByRole('button', { name: '查看 严重修复中' })
    await user.click(matrixButton)
    expect(within(context).getByRole('heading', { name: '严重修复中' }))
      .toBeVisible()
    expect(within(queue).getByRole('button', { name: '分诊 严重修复中' }))
      .toHaveAttribute('aria-pressed', 'true')

    const queueButton = within(queue).getByRole('button', {
      name: '分诊 一般验证中',
    })
    await user.click(queueButton)
    expect(within(context).getByRole('heading', { name: '一般验证中' }))
      .toBeVisible()
    expect(screen.getByRole('button', { name: '查看 一般验证中' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('preserves real linked task and requirement records in context', async () => {
    renderApp(<AppRoutes />, { route: '/defects' })

    const context = await screen.findByRole('complementary', {
      name: '缺陷上下文',
    })
    expect(within(context).getByRole('heading', { name: '离线恢复失败' }))
      .toBeVisible()
    expect(within(context).getByText(/TASK-047/)).toBeVisible()
    expect(within(context).getByText(/REQ-013/)).toBeVisible()
    expect(within(context).getByRole('list', { name: '复现步骤' }))
      .toHaveTextContent('重新启动客户端')
  })

  it('creates a repair task from persistent context and exposes its link', async () => {
    let resolveTask:
      | ((task: Awaited<ReturnType<typeof projectRepository.createTaskFromDefect>>) => void)
      | undefined
    const original = projectRepository.createTaskFromDefect.bind(projectRepository)
    vi.spyOn(projectRepository, 'createTaskFromDefect').mockImplementationOnce(
      (defectId) => new Promise((resolve) => {
        resolveTask = resolve
      }).then(() => original(defectId)),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    const context = await screen.findByRole('complementary', {
      name: '缺陷上下文',
    })
    const conversion = within(context).getByRole('button', {
      name: '转为修复任务',
    })
    await user.click(conversion)
    expect(conversion).toBeDisabled()
    expect(conversion).toHaveTextContent('正在创建')

    resolveTask?.({} as never)
    const link = await within(context).findByRole('link', {
      name: /FIX-D-104 修复：离线恢复失败/,
    })
    expect(link).toHaveAttribute(
      'href',
      '/tasks?selected=task-fix-defect-104',
    )
  })

  it('retains the selected context and reports conversion errors', async () => {
    vi.spyOn(projectRepository, 'createTaskFromDefect').mockRejectedValueOnce(
      new Error('转换服务暂不可用'),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    const context = await screen.findByRole('complementary', {
      name: '缺陷上下文',
    })
    await user.click(within(context).getByRole('button', {
      name: '转为修复任务',
    }))

    expect(await within(context).findByRole('alert')).toHaveTextContent(
      '转换服务暂不可用',
    )
    expect(within(context).getByRole('heading', { name: '离线恢复失败' }))
      .toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps active scope selection honest and derives a visible fallback', async () => {
    const user = userEvent.setup()
    renderWithDefects(stageFixtures)

    await screen.findByRole('complementary', { name: '缺陷上下文' })
    await user.click(screen.getByRole('button', { name: '查看 一般已关闭' }))
    expect(screen.getByRole('complementary', { name: '缺陷上下文' }))
      .toHaveTextContent('一般已关闭')

    await user.click(screen.getByRole('button', { name: '活跃缺陷' }))

    expect(screen.queryByRole('button', { name: '查看 一般已关闭' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '缺陷上下文' }))
      .toHaveTextContent('致命待处理')
  })

  it('renders loading, error, empty matrix, queue and context states', async () => {
    vi.spyOn(projectRepository, 'listDefects').mockImplementationOnce(
      () => new Promise(() => {}),
    )
    const loading = renderApp(<DefectPage />)
    expect(await screen.findByRole('status', { name: '正在加载项目数据' }))
      .toBeVisible()
    loading.unmount()

    vi.spyOn(projectRepository, 'listDefects').mockRejectedValueOnce(
      new Error('缺陷数据不可用'),
    )
    const failed = renderApp(<DefectPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('缺陷数据不可用')
    failed.unmount()

    vi.spyOn(projectRepository, 'listDefects').mockResolvedValueOnce([])
    renderApp(<DefectPage />)
    expect(await screen.findByText('当前项目暂无缺陷')).toBeVisible()
    expect(screen.getByRole('region', { name: '优先分诊队列' }))
      .toHaveTextContent('当前没有待分诊缺陷')
    expect(screen.getByRole('complementary', { name: '缺陷上下文' }))
      .toHaveTextContent('暂无缺陷上下文')
  })

  it('keeps the compact matrix locally scrollable and stacks below desktop', () => {
    expect(defectGlassCss).toMatch(
      /\.defect-page__layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(/s,
    )
    expect(defectGlassCss).toMatch(
      /\.defect-matrix-scroll\s*{[^}]*overflow-x:\s*auto/s,
    )
    expect(defectGlassCss).not.toMatch(/\.defect-matrix\s*{[^}]*72rem/s)
    expect(defectGlassCss).toMatch(
      /@media\s*\(max-width:\s*67\.5rem\)[\s\S]*?\.defect-page__layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    )
  })
})
