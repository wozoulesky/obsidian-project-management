import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import { ApiError } from '../../data/api-client'
import type { Project } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { DeleteProjectDialog } from './DeleteProjectDialog'

const project: Project = {
  id: 'atlas',
  code: 'PRJ-001',
  name: 'Atlas 研发平台',
  description: '统一项目协作入口',
  ownerId: 'owner-active',
  startDate: '2026-07-01',
  dueDate: '2026-08-31',
  status: 'in_progress',
  progress: 62,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-28T04:00:00.000Z',
  version: 4,
}

const deletionResult = {
  id: project.id,
  name: project.name,
  deletedAt: '2026-08-02T00:00:00.000Z',
  deletedCounts: {
    project_members: 2,
    tasks: 3,
    requirements: 1,
    defects: 1,
    sessions: 1,
    handoffs: 1,
    deliverables: 1,
  },
} satisfies Awaited<ReturnType<typeof projectRepository.deleteProject>>

afterEach(cleanup)

function renderDialog({
  onClose = vi.fn(),
  onDeleted = vi.fn(),
}: {
  onClose?: () => void
  onDeleted?: () => void
} = {}) {
  renderApp(
    <DeleteProjectDialog
      onClose={onClose}
      onDeleted={onDeleted}
      project={project}
    />,
  )
  return { onClose, onDeleted }
}

function FocusReturnHarness() {
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button onClick={() => setOpen(true)} ref={openerRef} type="button">
        打开删除确认
      </button>
      {open ? (
        <DeleteProjectDialog
          onClose={() => {
            setOpen(false)
            openerRef.current?.focus()
          }}
          onDeleted={() => undefined}
          project={project}
        />
      ) : null}
    </>
  )
}

describe('DeleteProjectDialog', () => {
  it('describes permanent cascading deletion and requires the exact project name', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', {
      name: `永久删除项目 ${project.name}`,
    })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/永久不可恢复/)
    expect(dialog).toHaveAccessibleDescription(/任务、成员关系、交接记录和交付物/)
    expect(dialog).toHaveAccessibleDescription(/需求、缺陷和会话/)
    const confirmation = within(dialog).getByLabelText(
      `输入 ${project.name} 以确认`,
    )
    const submit = within(dialog).getByRole('button', { name: '永久删除项目' })
    expect(confirmation).toHaveFocus()
    expect(submit).toBeDisabled()

    await user.type(confirmation, `${project.name} `)
    expect(submit).toBeDisabled()
    await user.clear(confirmation)
    await user.type(confirmation, project.name)
    expect(submit).toBeEnabled()
  })

  it('submits once, locks closing while pending, and reports progress', async () => {
    const user = userEvent.setup()
    let resolveDeletion!: (value: typeof deletionResult) => void
    const deletion = new Promise<typeof deletionResult>((resolve) => {
      resolveDeletion = resolve
    })
    const deleteProject = vi.spyOn(projectRepository, 'deleteProject')
      .mockReturnValue(deletion)
    const { onClose, onDeleted } = renderDialog()
    const confirmation = screen.getByLabelText(`输入 ${project.name} 以确认`)
    await user.type(confirmation, project.name)

    const submit = screen.getByRole('button', { name: '永久删除项目' })
    await user.click(submit)
    expect(screen.getByRole('button', { name: '正在永久删除…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '关闭永久删除项目' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '关闭永久删除项目' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    expect(deleteProject).toHaveBeenCalledTimes(1)

    resolveDeletion(deletionResult)
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(deleteProject).toHaveBeenCalledWith(project.id, project.version)
  })

  it('traps focus and restores it after cancel or Escape', async () => {
    const user = userEvent.setup()
    renderApp(<FocusReturnHarness />)
    const opener = screen.getByRole('button', { name: '打开删除确认' })

    await user.click(opener)
    const confirmation = screen.getByLabelText(`输入 ${project.name} 以确认`)
    await user.type(confirmation, project.name)
    const close = screen.getByRole('button', { name: '关闭永久删除项目' })
    const submit = screen.getByRole('button', { name: '永久删除项目' })
    close.focus()
    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()

    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it.each([
    [
      'PROJECT_VERSION_CONFLICT',
      '项目已被修改，请刷新后重新确认。',
    ],
    [
      'DEFAULT_PROJECT_PROTECTED',
      '默认项目受保护，无法删除。',
    ],
    [
      'PROJECT_DELETE_FORBIDDEN',
      '你没有删除此项目的权限。',
    ],
  ])('maps %s and preserves confirmation for retry', async (code, message) => {
    const user = userEvent.setup()
    const deleteProject = vi.spyOn(projectRepository, 'deleteProject')
      .mockRejectedValueOnce(new ApiError({
        code,
        message: 'server detail',
        status: 409,
      }))
      .mockResolvedValueOnce(deletionResult)
    const { onDeleted } = renderDialog()
    const confirmation = screen.getByLabelText(`输入 ${project.name} 以确认`)
    await user.type(confirmation, project.name)

    await user.click(screen.getByRole('button', { name: '永久删除项目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(confirmation).toHaveValue(project.name)
    await user.click(screen.getByRole('button', { name: '永久删除项目' }))
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(deleteProject).toHaveBeenCalledTimes(2)
  })

  it('keeps an understandable network error message', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'deleteProject').mockRejectedValue(
      new Error('连接超时'),
    )
    renderDialog()
    const confirmation = screen.getByLabelText(`输入 ${project.name} 以确认`)
    await user.type(confirmation, project.name)
    await user.click(screen.getByRole('button', { name: '永久删除项目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '删除失败：连接超时，请稍后重试。',
    )
    expect(confirmation).toHaveValue(project.name)
  })
})
