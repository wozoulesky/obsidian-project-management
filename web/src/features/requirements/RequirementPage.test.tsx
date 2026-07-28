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
  RequirementPage,
} from './RequirementPage'

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

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await projectRepository.updateRequirementStatus('req-013', 'developing')
  await projectRepository.updateRequirementStatus('req-017', 'reviewed')
})

describe('RequirementPage lifecycle board', () => {
  it('groups the default board and keeps draft and accepted in compact summaries', async () => {
    renderApp(<RequirementPage />)

    const reviewed = await screen.findByRole('region', {
      name: '已评审需求',
    })
    const developing = screen.getByRole('region', { name: '开发中需求' })
    const delivered = screen.getByRole('region', { name: '已交付需求' })

    expect(within(reviewed).getByRole('heading', { name: '已评审' }))
      .toHaveTextContent('3')
    expect(within(developing).getByRole('heading', { name: '开发中' }))
      .toHaveTextContent('1')
    expect(within(delivered).getByRole('heading', { name: '已交付' }))
      .toHaveTextContent('7')
    expect(screen.getByText('草稿 2')).toBeVisible()
    expect(screen.getByText('已验收 7')).toBeVisible()
    expect(
      screen.getByRole('button', { name: '查看 Agent 身份注册' }),
    ).toBeVisible()
    expect(screen.queryByText('项目能力需求 02')).not.toBeInTheDocument()
    expect(screen.queryByText('项目能力需求 15')).not.toBeInTheDocument()
  })

  it('shows complete card identity and linked-task progress', async () => {
    renderApp(<RequirementPage />)

    const card = (await screen.findByRole('button', {
      name: '查看 Agent 身份注册',
    })).closest('article')

    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('REQ-013')).toBeVisible()
    expect(within(card as HTMLElement).getByText('P0')).toBeVisible()
    expect(within(card as HTMLElement).getByText('3/4 任务')).toBeVisible()
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
    expect(within(dialog).getByText('3/4 任务已完成')).toBeVisible()
    expect(within(dialog).getByRole('heading', { name: '活动历史' }))
      .toBeVisible()
    expect(within(dialog).getByText('暂无相关活动')).toBeVisible()
    expect(updateStatus).not.toHaveBeenCalled()
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
    vi.spyOn(projectRepository, 'updateRequirementStatus').mockRejectedValueOnce(
      new Error('状态服务不可用'),
    )
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
    expect(screen.getByRole('heading', { name: '需求生命周期' }))
      .toHaveFocus()
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
      name: '需求生命周期',
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

    expect(screen.getByRole('status')).toHaveTextContent('正在加载需求')
  })

  it('shows query errors', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockRejectedValueOnce(
      new Error('offline'),
    )

    renderApp(<RequirementPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('需求加载失败')
  })

  it('shows an empty project state', async () => {
    vi.spyOn(projectRepository, 'listRequirements').mockResolvedValueOnce([])

    renderApp(<RequirementPage />)

    expect(await screen.findByText('当前没有需求。')).toBeVisible()
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

    await screen.findByRole('heading', { name: '需求生命周期' })
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
