import {
  act,
  cleanup,
  fireEvent,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

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

describe('RequirementPage lifecycle board', () => {
  it('renders the real five-stage pipeline with static endpoints', async () => {
    renderApp(<RequirementPage />)

    expect(await screen.findByRole('heading', { name: '需求管线' }))
      .toBeVisible()
    const draft = screen.getByRole('region', { name: '收集需求' })
    const reviewed = await screen.findByRole('region', {
      name: '评审需求',
    })
    const developing = screen.getByRole('region', { name: '开发中需求' })
    const delivered = screen.getByRole('region', { name: '已交付需求' })
    const accepted = screen.getByRole('region', { name: '已验收需求' })

    expect(within(draft).getByRole('heading', { name: '收集' }))
      .toHaveTextContent('2')
    expect(within(reviewed).getByRole('heading', { name: '评审' }))
      .toHaveTextContent('3')
    expect(within(developing).getByRole('heading', { name: '开发中' }))
      .toHaveTextContent('1')
    expect(within(delivered).getByRole('heading', { name: '已交付' }))
      .toHaveTextContent('7')
    expect(within(accepted).getByRole('heading', { name: '已验收' }))
      .toHaveTextContent('7')
    expect(
      screen.getByRole('button', { name: '查看 Agent 身份注册' }),
    ).toBeVisible()
    expect(within(draft).getByText('项目能力需求 15')).toBeVisible()
    expect(within(accepted).getByText('项目能力需求 02')).toBeVisible()
    expect(within(draft).queryByRole('button', { name: /^拖动 / }))
      .not.toBeInTheDocument()
    expect(within(accepted).queryByRole('button', { name: /^拖动 / }))
      .not.toBeInTheDocument()
    expect(within(reviewed).getAllByRole('button', { name: /^拖动 / }))
      .toHaveLength(3)
  })

  it('shows metrics derived from the current requirement query', async () => {
    renderApp(<RequirementPage />)

    const metrics = await screen.findByRole('group', {
      name: '需求管线指标',
    })
    expect(within(metrics).getByText('需求总数').nextElementSibling)
      .toHaveTextContent('20')
    expect(within(metrics).getByText('开发中').nextElementSibling)
      .toHaveTextContent('1')
    expect(within(metrics).getByText('已验收').nextElementSibling)
      .toHaveTextContent('7')
  })

  it('shows complete card identity and linked-task progress', async () => {
    renderApp(<RequirementPage />)

    const card = (await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    })).closest('article')

    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('REQ-013')).toBeVisible()
    expect(within(card as HTMLElement).getByText('P0')).toBeVisible()
    expect(within(card as HTMLElement).getByText('4/4 任务')).toBeVisible()
    expect(
      within(card as HTMLElement).getByText(
        '关联任务完成后可流转至已交付',
      ),
    ).toBeVisible()
  })

  it('suggests delivery without mutating and exposes a labeled status select', async () => {
    const updateStatus = vi.spyOn(
      projectRepository,
      'updateRequirementStatus',
    )
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    }))

    const dialog = screen.getByRole('dialog', {
      name: 'Agent 身份注册',
    })
    expect(within(dialog).getByText('关联任务完成后可流转至已交付'))
      .toBeVisible()
    expect(within(dialog).getByRole('combobox', { name: '需求状态' }))
      .toHaveValue('developing')
    expect(within(dialog).getByRole('heading', { name: '验收标准' }))
      .toBeVisible()
    expect(within(dialog).getByText('4/4 任务已完成')).toBeVisible()
    expect(within(dialog).getByRole('heading', { name: '活动历史' }))
      .toBeVisible()
    expect(within(dialog).getByText('暂无相关活动')).toBeVisible()
    expect(updateStatus).not.toHaveBeenCalled()
  })

  it.each([
    {
      title: '未完成的开发需求',
      linkedTaskIds: ['task-a', 'task-b', 'task-c', 'task-d'],
      completedTaskCount: 3,
    },
    {
      title: '没有关联任务的开发需求',
      linkedTaskIds: [],
      completedTaskCount: 0,
    },
  ])('does not suggest delivery for $title', async ({
    completedTaskCount,
    linkedTaskIds,
    title,
  }) => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([
      requirement({
        id: `req-${completedTaskCount}-${linkedTaskIds.length}`,
        title,
        status: 'developing',
        linkedTaskIds,
        completedTaskCount,
      }),
    ])
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    const trigger = await screen.findByRole('button', {
      name: `查看 ${title}`,
    })
    const card = trigger.closest('article')
    expect(card).not.toBeNull()
    expect(
      within(card as HTMLElement).queryByText(
        '关联任务完成后可流转至已交付',
      ),
    ).not.toBeInTheDocument()

    await user.click(trigger)
    expect(
      within(screen.getByRole('dialog', { name: title })).queryByText(
        '关联任务完成后可流转至已交付',
      ),
    ).not.toBeInTheDocument()
  })

  it('updates only after an explicit save and moves the latest query result', async () => {
    const updateStatus = vi.spyOn(
      projectRepository,
      'updateRequirementStatus',
    )
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    }))
    const dialog = screen.getByRole('dialog', {
      name: 'Agent 身份注册',
    })
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '需求状态' }),
      'delivered',
    )
    expect(updateStatus).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: '保存需求状态' }),
    )

    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith('req-013', 'delivered')
    })
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: '已交付需求' }))
          .getByRole('button', { name: '查看 Agent 身份注册' }),
      ).toBeVisible()
    })
  })

  it('keeps the selected value and reports an update error', async () => {
    const updateStatus = vi.spyOn(
      projectRepository,
      'updateRequirementStatus',
    ).mockRejectedValueOnce(new Error('状态服务不可用'))
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    }))
    const dialog = screen.getByRole('dialog', {
      name: 'Agent 身份注册',
    })
    const select = within(dialog).getByRole('combobox', {
      name: '需求状态',
    })
    await user.selectOptions(select, 'delivered')
    await user.click(
      within(dialog).getByRole('button', { name: '保存需求状态' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '状态服务不可用',
    )
    expect(select).toHaveValue('delivered')

    await user.click(
      within(dialog).getByRole('button', { name: '保存需求状态' }),
    )
    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('disables save while the explicit update is pending', async () => {
    vi.spyOn(projectRepository, 'updateRequirementStatus').mockImplementationOnce(
      () => new Promise(() => {}),
    )
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    }))
    const dialog = screen.getByRole('dialog', {
      name: 'Agent 身份注册',
    })
    const save = within(dialog).getByRole('button', {
      name: '保存需求状态',
    })
    await user.click(save)

    expect(save).toBeDisabled()
  })

  it('serializes inspector save and drag, then unlocks after settlement', async () => {
    mockBoardRects()
    const pending = deferred<Requirement>()
    const updateStatus = vi.spyOn(
      projectRepository,
      'updateRequirementStatus',
    ).mockImplementationOnce(() => pending.promise)
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    }))
    const dialog = screen.getByRole('dialog', { name: 'Agent 身份注册' })
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '需求状态' }),
      'delivered',
    )
    await user.click(
      within(dialog).getByRole('button', { name: '保存需求状态' }),
    )

    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledTimes(1)
    })
    const handles = screen.getAllByRole('button', { name: /^拖动 / })
    await waitFor(() => {
      expect(handles.every((handle) => handle.hasAttribute('disabled')))
        .toBe(true)
    })
    const developingHandle = screen.getByRole('button', {
      name: '拖动 Agent 身份注册',
    })
    fireEvent.keyDown(developingHandle, { code: 'Space', key: ' ' })
    fireEvent.keyDown(developingHandle, {
      code: 'ArrowLeft',
      key: 'ArrowLeft',
    })
    fireEvent.keyDown(developingHandle, { code: 'Space', key: ' ' })
    expect(updateStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(requirement({
        id: 'req-013',
        title: 'Agent 身份注册',
        status: 'delivered',
      }))
      await pending.promise
    })
    await waitFor(() => {
      expect(developingHandle).not.toBeDisabled()
    })

    developingHandle.focus()
    await user.keyboard('[Space]{ArrowLeft}[Space]')
    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledTimes(2)
    })
  })

  it('reports a rejected drag mutation and unlocks the handles', async () => {
    mockBoardRects()
    vi.spyOn(projectRepository, 'updateRequirementStatus').mockRejectedValueOnce(
      new Error('拖拽状态更新失败'),
    )
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    const handle = await screen.findByRole('button', {
      name: '拖动 项目排期可视化',
    })
    handle.focus()
    await user.keyboard('[Space]{ArrowRight}[Space]')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '拖拽状态更新失败',
    )
    await waitFor(() => {
      expect(handle).not.toBeDisabled()
    })
  })

  it('exposes localized keyboard drag instructions and wired handles', async () => {
    renderApp(<RequirementPage />)

    const handle = await screen.findByRole('button', {
      name: '拖动 Agent 身份注册',
    })
    expect(handle).toHaveAttribute('role', 'button')
    expect(handle).toHaveAttribute('tabindex', '0')
    const describedBy = handle.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      '按空格键拿起需求卡片',
    )
  })

  it('closes after its selected card is filtered out and focuses the page heading', async () => {
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: '终态筛选' }),
      'rejected',
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.getElementById('requirement-page-heading')).toHaveFocus()
  })

  it('restores focus to the stable card trigger when the inspector closes', async () => {
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    const trigger = await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    })
    expect(trigger).toHaveAttribute('id', 'requirement-trigger-req-013')
    await user.click(trigger)
    await user.click(screen.getByRole('button', {
      name: '关闭 Agent 身份注册',
    }))

    expect(trigger).toHaveFocus()
  })

  it('renders the real page on the requirements route', async () => {
    renderApp(<AppRoutes />, { route: '/requirements' })

    expect(await screen.findByRole('heading', {
      name: '需求管线',
    })).toBeVisible()
    expect(screen.getByRole('region', { name: '开发中需求' })).toBeVisible()
  })
})

describe('RequirementPage query and terminal states', () => {
  it('shows loading state', () => {
    vi.spyOn(projectRepository, 'listRequirements').mockImplementationOnce(
      () => new Promise(() => {}),
    )

    renderApp(<RequirementPage />)

    expect(
      screen.getByRole('status', { name: '正在加载项目数据' }),
    ).toBeVisible()
  })

  it('shows query errors', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockRejectedValueOnce(
      new Error('数据库文件不可访问'),
    )

    renderApp(<RequirementPage />)

    expect(
      await screen.findByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('数据库文件不可访问')
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
  })

  it('shows an empty project state', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([])

    renderApp(<RequirementPage />)

    expect(await screen.findByText('当前项目暂无需求')).toBeVisible()
  })

  it('shows rejected and shelved only through the terminal-state filter', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([
      requirement({
        id: 'req-rejected',
        title: '被拒绝的需求',
        status: 'rejected',
      }),
      requirement({
        id: 'req-shelved',
        title: '已搁置的需求',
        status: 'shelved',
      }),
    ])
    const user = userEvent.setup()
    renderApp(<RequirementPage />)

    await screen.findByRole('heading', { name: '需求管线' })
    expect(screen.queryByText('被拒绝的需求')).not.toBeInTheDocument()
    expect(screen.queryByText('已搁置的需求')).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '终态筛选' }),
      'rejected',
    )
    expect(screen.getByRole('button', { name: '查看 被拒绝的需求' }))
      .toBeVisible()
    expect(screen.queryByText('已搁置的需求')).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '终态筛选' }),
      'shelved',
    )
    expect(screen.getByRole('button', { name: '查看 已搁置的需求' }))
      .toBeVisible()
    expect(screen.queryByText('被拒绝的需求')).not.toBeInTheDocument()
  })
})

describe('applyRequirementDrop', () => {
  it('does not update for invalid, terminal, or same-column drops', () => {
    const update = vi.fn()
    const source = [
      requirement({ id: 'req-reviewed', status: 'reviewed' }),
    ]

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
  it('suggests only a developing requirement with all linked tasks complete', () => {
    expect(canSuggestDelivery(requirement({
      status: 'developing',
      linkedTaskIds: ['task-a', 'task-b'],
      completedTaskCount: 2,
    }))).toBe(true)
    expect(canSuggestDelivery(requirement({
      status: 'delivered',
      linkedTaskIds: ['task-a'],
      completedTaskCount: 1,
    }))).toBe(false)
  })

  it('rejects incomplete developing requirements', () => {
    expect(canSuggestDelivery(requirement({
      status: 'developing',
      linkedTaskIds: ['task-a', 'task-b', 'task-c', 'task-d'],
      completedTaskCount: 3,
    }))).toBe(false)
  })

  it('rejects a developing requirement with no linked tasks', () => {
    expect(canSuggestDelivery(requirement({
      status: 'developing',
      linkedTaskIds: [],
      completedTaskCount: 0,
    }))).toBe(false)
  })
})

describe('requirement DnD accessibility helpers', () => {
  it('moves left or right to one adjacent lifecycle column', () => {
    expect(getAdjacentBoardStatus('developing', 'ArrowLeft')).toBe('reviewed')
    expect(getAdjacentBoardStatus('developing', 'ArrowRight'))
      .toBe('delivered')
    expect(getAdjacentBoardStatus('reviewed', 'ArrowLeft')).toBeNull()
    expect(getAdjacentBoardStatus('delivered', 'ArrowRight')).toBeNull()
  })

  it('announces requirement titles and localized statuses without internal IDs', () => {
    const announcements = createRequirementAnnouncements([
      requirement({
        id: 'internal-req-id',
        title: '中文需求标题',
        status: 'developing',
      }),
    ])
    const active = { id: 'internal-req-id' }
    const over = { id: 'delivered' }
    const start = announcements.onDragStart({ active } as never)
    const overMessage = announcements.onDragOver({ active, over } as never)
    const end = announcements.onDragEnd({ active, over } as never)
    const cancel = announcements.onDragCancel(
      { active, over: null } as never,
    )

    expect(start).toContain('中文需求标题')
    expect(overMessage).toContain('已交付')
    expect(end).toContain('中文需求标题')
    expect(end).toContain('已交付')
    expect(cancel).toContain('已取消')
    expect([start, overMessage, end, cancel].join(' '))
      .not.toContain('internal-req-id')
  })
})
