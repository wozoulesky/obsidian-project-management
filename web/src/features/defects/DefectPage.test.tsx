import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Defect } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { sortDefects } from './DefectPage'

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('sortDefects', () => {
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
  it('renders the fatal risk first in a semantic five-column queue', async () => {
    renderApp(<AppRoutes />, { route: '/defects' })

    const table = await screen.findByRole('table', { name: '缺陷风险队列' })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['缺陷', '严重度', '状态', '负责人', '更新时间'])

    const firstDataRow = within(table).getAllByRole('row')[1]!
    expect(firstDataRow).toHaveTextContent('离线恢复失败')
    expect(firstDataRow).toHaveTextContent('致命')
    expect(firstDataRow).not.toHaveClass('is-fatal')
  })

  it('shows compact status summaries and explicit all/active scope', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    await screen.findByRole('table', { name: '缺陷风险队列' })
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

  it('inspects reproduction, relationships, attachments, activity, and restores focus', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/defects' })

    const trigger = await screen.findByRole('button', {
      name: '查看 离线恢复失败',
    })
    expect(trigger).toHaveAttribute('id', 'defect-trigger-defect-104')
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '离线恢复失败' })
    expect(within(dialog).getByRole('list')).toHaveTextContent('重新启动客户端')
    expect(within(dialog).getByText(/TASK-047/)).toBeVisible()
    expect(within(dialog).getByText(/REQ-013/)).toBeVisible()
    expect(within(dialog).getByText('暂无附件')).toBeVisible()
    expect(within(dialog).getByText('暂无相关活动')).toBeVisible()

    await user.click(
      within(dialog).getByRole('button', { name: '关闭 离线恢复失败' }),
    )
    expect(trigger).toHaveFocus()
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
    expect(link).toHaveAttribute('href', expect.stringContaining('/tasks'))
    expect(within(dialog).getAllByText(/FIX-D-104/)).toHaveLength(2)
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
    expect(await screen.findByRole('status')).toHaveTextContent('正在加载缺陷')
    loading.unmount()

    vi.spyOn(projectRepository, 'listDefects').mockRejectedValueOnce(
      new Error('缺陷数据不可用'),
    )
    const error = renderApp(<AppRoutes />, { route: '/defects' })
    expect(await screen.findByRole('alert')).toHaveTextContent('缺陷数据不可用')
    error.unmount()

    vi.spyOn(projectRepository, 'listDefects').mockResolvedValueOnce([])
    renderApp(<AppRoutes />, { route: '/defects' })
    expect(await screen.findByText('暂无缺陷')).toBeVisible()
  })
})
