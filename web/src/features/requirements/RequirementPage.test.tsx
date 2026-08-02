import {
  cleanup,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Requirement } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import {
  applyRequirementDrop,
  canSuggestDelivery,
  createRequirementAnnouncements,
  getAdjacentBoardStatus,
  RequirementPage,
} from './RequirementPage'

function mockBoardRects() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const region = this.matches('[aria-label$="需求"]')
        ? this
        : this.closest<HTMLElement>('[aria-label$="需求"]')
      const label = region?.getAttribute('aria-label')
      const left = label === '已评审需求'
        ? 0
        : label === '开发中需求'
          ? 240
          : label === '已交付需求'
            ? 480
            : 0
      return {
        bottom: 200,
        height: 200,
        left,
        right: left + 220,
        top: 0,
        width: 220,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
}

function requirement(overrides: Partial<Requirement>): Requirement {
  return {
    id: 'req-test',
    code: 'REQ-TEST',
    title: '测试需求',
    description: '这是来自需求记录的真实描述。',
    priority: 'P1',
    status: 'reviewed',
    linkedTaskIds: [],
    completedTaskCount: 0,
    acceptanceCriteria: ['满足测试验收条件'],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RequirementPage approved pipeline workspace', () => {
  it('renders four honest metrics from the current requirement query', async () => {
    renderApp(<RequirementPage />)

    const metrics = await screen.findByRole('group', {
      name: '需求管线指标',
    })
    expect(within(metrics).getAllByRole('article')).toHaveLength(4)
    expect(within(metrics).getByText('需求总数').nextElementSibling)
      .toHaveTextContent('20')
    expect(within(metrics).getByText('已评审').nextElementSibling)
      .toHaveTextContent('3')
    expect(within(metrics).getByText('开发中').nextElementSibling)
      .toHaveTextContent('1')
    expect(within(metrics).getByText('已交付').nextElementSibling)
      .toHaveTextContent('7')
  })

  it('keeps the five-stage pipeline and persistent context in one stage', async () => {
    renderApp(<RequirementPage />)

    const layout = await screen.findByTestId('requirement-layout')
    const pipeline = within(layout).getByRole('region', {
      name: '需求生命周期管线',
    })
    const context = within(layout).getByRole('complementary', {
      name: '需求上下文',
    })
    const scroll = within(pipeline).getByRole('region', {
      name: '需求生命周期五列管线，可横向滚动',
    })

    expect(layout).toHaveAttribute('data-layout', 'pipeline-context')
    expect(scroll).toHaveClass('requirement-page__board-scroll')
    expect(within(scroll).getAllByRole('region', { name: /需求$/ }))
      .toHaveLength(5)
    expect(within(scroll).getByRole('region', { name: '收集需求' }))
      .toBeVisible()
    expect(within(scroll).getByRole('region', { name: '已评审需求' }))
      .toBeVisible()
    expect(within(scroll).getByRole('region', { name: '开发中需求' }))
      .toBeVisible()
    expect(within(scroll).getByRole('region', { name: '已交付需求' }))
      .toBeVisible()
    expect(within(scroll).getByRole('region', { name: '已验收需求' }))
      .toBeVisible()
    expect(within(context).getByRole('heading', { name: 'Agent 身份注册' }))
      .toBeVisible()
    expect(within(context).getByText('REQ-013')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows only recorded fields and linked data in the context', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([
      requirement({
        id: 'req-real',
        code: 'REQ-REAL',
        title: '真实需求上下文',
        description: '保留已有状态与关联数据。',
        priority: 'P0',
        status: 'developing',
        linkedTaskIds: ['task-a', 'task-b'],
        completedTaskCount: 1,
        acceptanceCriteria: ['上下文不伪造负责人'],
      }),
    ])
    renderApp(<RequirementPage />)

    const context = await screen.findByRole('complementary', {
      name: '需求上下文',
    })
    expect(within(context).getByText('REQ-REAL')).toBeVisible()
    expect(within(context).getByText('状态').nextElementSibling)
      .toHaveTextContent('开发中')
    expect(within(context).getByText('P0')).toBeVisible()
    expect(within(context).getByText('保留已有状态与关联数据。'))
      .toBeVisible()
    expect(within(context).getByText('1 / 2 已完成')).toBeVisible()
    expect(within(context).getByText('task-a、task-b')).toBeVisible()
    expect(within(context).getByText('上下文不伪造负责人')).toBeVisible()
    expect(within(context).queryByText('负责人')).not.toBeInTheDocument()
    expect(within(context).queryByText('变更风险')).not.toBeInTheDocument()
  })

  it('updates the persistent context when a requirement card is selected', async () => {
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    const context = await screen.findByRole('complementary', {
      name: '需求上下文',
    })
    expect(within(context).getByRole('heading', { name: 'Agent 身份注册' }))
      .toBeVisible()

    await user.click(screen.getByRole('button', {
      name: '查看 项目排期可视化',
    }))

    expect(within(context).getByRole('heading', { name: '项目排期可视化' }))
      .toBeVisible()
    expect(within(context).getByText('REQ-017')).toBeVisible()
    expect(screen.getByRole('button', { name: '查看 项目排期可视化' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves the selected requirement by keyboard drag and syncs its context', async () => {
    mockBoardRects()
    const updateStatus = vi.spyOn(projectRepository, 'updateRequirementStatus')
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    const context = await screen.findByRole('complementary', {
      name: '需求上下文',
    })
    const handle = screen.getByRole('button', {
      name: '拖动 Agent 身份注册',
    })
    expect(within(context).getByText('状态').nextElementSibling)
      .toHaveTextContent('开发中')

    handle.focus()
    await user.keyboard('[Space]{ArrowRight}[Space]')

    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith('req-013', 'delivered')
    })
    await waitFor(() => {
      expect(within(context).getByText('状态').nextElementSibling)
        .toHaveTextContent('已交付')
    })
    expect(within(screen.getByRole('region', { name: '已交付需求' }))
      .getByRole('button', { name: '查看 Agent 身份注册' })).toBeVisible()
  })

  it('reports a rejected drag and keeps the selected context unchanged', async () => {
    mockBoardRects()
    vi.spyOn(projectRepository, 'updateRequirementStatus').mockRejectedValueOnce(
      new Error('拖拽状态更新失败'),
    )
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 项目排期可视化',
    }))
    const context = screen.getByRole('complementary', {
      name: '需求上下文',
    })
    const handle = screen.getByRole('button', {
      name: '拖动 项目排期可视化',
    })
    expect(within(context).getByText('状态').nextElementSibling)
      .toHaveTextContent('已评审')

    handle.focus()
    await user.keyboard('[Space]{ArrowRight}[Space]')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '拖拽状态更新失败',
    )
    expect(within(context).getByText('状态').nextElementSibling)
      .toHaveTextContent('已评审')
    await waitFor(() => expect(handle).not.toBeDisabled())
  })

  it('keeps static lifecycle endpoints and localized keyboard controls', async () => {
    renderApp(<RequirementPage />)

    const draft = await screen.findByRole('region', { name: '收集需求' })
    const reviewed = screen.getByRole('region', { name: '已评审需求' })
    const accepted = screen.getByRole('region', { name: '已验收需求' })

    expect(within(draft).queryByRole('button', { name: /^拖动 / }))
      .not.toBeInTheDocument()
    expect(within(accepted).queryByRole('button', { name: /^拖动 / }))
      .not.toBeInTheDocument()
    expect(within(reviewed).getAllByRole('button', { name: /^拖动 / }))
      .toHaveLength(3)
    const handle = screen.getByRole('button', {
      name: '拖动 Agent 身份注册',
    })
    const describedBy = handle.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      '按空格键拿起需求卡片',
    )
  })

  it('renders the real page on the requirements route', async () => {
    renderApp(<AppRoutes />, { route: '/requirements' })

    expect(await screen.findByRole('heading', { name: '需求管线' }))
      .toBeVisible()
    expect(screen.getByRole('region', { name: '需求生命周期管线' }))
      .toBeVisible()
    expect(screen.getByRole('complementary', { name: '需求上下文' }))
      .toBeVisible()
  })
})

describe('RequirementPage query and terminal states', () => {
  it('shows loading state', () => {
    vi.spyOn(projectRepository, 'listRequirements').mockImplementationOnce(
      () => new Promise(() => {}),
    )
    renderApp(<RequirementPage />)
    expect(screen.getByRole('status', { name: '正在加载项目数据' }))
      .toBeVisible()
  })

  it('shows query errors and retry control', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockRejectedValueOnce(
      new Error('数据库文件不可访问'),
    )
    renderApp(<RequirementPage />)
    expect(await screen.findByRole('heading', {
      name: '无法读取本地项目数据',
    })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('数据库文件不可访问')
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
  })

  it('shows a compact empty workspace and context state', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([])
    renderApp(<RequirementPage />)

    expect(await screen.findByText('当前项目暂无需求')).toBeVisible()
    const context = screen.getByRole('complementary', { name: '需求上下文' })
    expect(within(context).getByText('暂无需求上下文')).toBeVisible()
    expect(within(context).getByText('当前筛选范围没有可检查的需求。'))
      .toBeVisible()
  })

  it('uses the first visible terminal requirement as its context', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([
      requirement({
        id: 'req-rejected',
        code: 'REQ-REJECTED',
        title: '被拒绝的需求',
        status: 'rejected',
      }),
      requirement({
        id: 'req-shelved',
        code: 'REQ-SHELVED',
        title: '已搁置的需求',
        status: 'shelved',
      }),
    ])
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await screen.findByRole('heading', { name: '需求管线' })
    expect(screen.getByText('当前五阶段管线暂无需求。')).toBeVisible()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '终态筛选' }),
      'rejected',
    )
    const context = screen.getByRole('complementary', { name: '需求上下文' })
    expect(within(context).getByRole('heading', { name: '被拒绝的需求' }))
      .toBeVisible()
    expect(screen.getByRole('button', { name: '查看 被拒绝的需求' }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})

describe('applyRequirementDrop', () => {
  it('does not update for invalid, terminal, or same-column drops', () => {
    const update = vi.fn()
    const source = [requirement({ id: 'req-reviewed', status: 'reviewed' })]

    expect(applyRequirementDrop(source, 'missing', 'developing', update))
      .toBeNull()
    expect(applyRequirementDrop(source, 'req-reviewed', null, update))
      .toBeNull()
    expect(applyRequirementDrop(source, 'req-reviewed', 'rejected', update))
      .toBeNull()
    expect(applyRequirementDrop(source, 'req-reviewed', 'reviewed', update))
      .toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('commits a valid board drop through the repository mutation', async () => {
    const source = await projectRepository.listRequirements('atlas')
    const result = applyRequirementDrop(
      source,
      'req-017',
      'developing',
      ({ requirementId, status }) =>
        projectRepository.updateRequirementStatus(requirementId, status),
    )

    expect(result).not.toBeNull()
    await result
    const latest = await projectRepository.listRequirements('atlas')
    expect(latest.find((item) => item.id === 'req-017')?.status)
      .toBe('developing')
  })
})

describe('canSuggestDelivery', () => {
  it('suggests only a developing requirement with completed linked tasks', () => {
    expect(canSuggestDelivery(requirement({
      status: 'developing',
      linkedTaskIds: ['task-a', 'task-b'],
      completedTaskCount: 2,
    }))).toBe(true)
    expect(canSuggestDelivery(requirement({
      status: 'developing',
      linkedTaskIds: [],
      completedTaskCount: 0,
    }))).toBe(false)
    expect(canSuggestDelivery(requirement({
      status: 'delivered',
      linkedTaskIds: ['task-a'],
      completedTaskCount: 1,
    }))).toBe(false)
  })
})

describe('requirement DnD accessibility helpers', () => {
  it('moves left or right to one adjacent draggable column', () => {
    expect(getAdjacentBoardStatus('developing', 'ArrowLeft')).toBe('reviewed')
    expect(getAdjacentBoardStatus('developing', 'ArrowRight'))
      .toBe('delivered')
    expect(getAdjacentBoardStatus('reviewed', 'ArrowLeft')).toBeNull()
    expect(getAdjacentBoardStatus('delivered', 'ArrowRight')).toBeNull()
  })

  it('announces titles and localized statuses without internal IDs', () => {
    const announcements = createRequirementAnnouncements([
      requirement({
        id: 'internal-req-id',
        title: '中文需求标题',
        status: 'developing',
      }),
    ])
    const active = { id: 'internal-req-id' }
    const over = { id: 'delivered' }
    const messages = [
      announcements.onDragStart({ active } as never),
      announcements.onDragOver({ active, over } as never),
      announcements.onDragEnd({ active, over } as never),
      announcements.onDragCancel({ active, over: null } as never),
    ].join(' ')

    expect(messages).toContain('中文需求标题')
    expect(messages).toContain('已交付')
    expect(messages).not.toContain('internal-req-id')
  })
})
