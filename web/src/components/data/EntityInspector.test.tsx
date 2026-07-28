import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EntityInspector } from './EntityInspector'

afterEach(cleanup)

function InspectorHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        查看任务
      </button>
      {open ? (
        <EntityInspector
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          title="MCP 权限校验"
        >
          <p>任务详情</p>
        </EntityInspector>
      ) : null}
    </>
  )
}

function ReplacedTriggerHarness() {
  const [open, setOpen] = useState(false)
  const [replacement, setReplacement] = useState(false)

  return (
    <>
      <button
        id="replaceable-trigger"
        key={replacement ? 'replacement' : 'original'}
        onClick={() => setOpen(true)}
        type="button"
      >
        {replacement ? '替换后的触发点' : '打开可替换触发点'}
      </button>
      {open ? (
        <EntityInspector
          onClose={() => setOpen(false)}
          returnFocusId="replaceable-trigger"
          title="可替换实体"
        >
          <button onClick={() => setReplacement(true)} type="button">
            替换触发点节点
          </button>
        </EntityInspector>
      ) : null}
    </>
  )
}

describe('EntityInspector', () => {
  it('labels the dialog with its title and moves focus to close', async () => {
    const user = userEvent.setup()
    render(<InspectorHarness />)

    await user.click(screen.getByRole('button', { name: '查看任务' }))

    const dialog = screen.getByRole('dialog', { name: 'MCP 权限校验' })
    expect(dialog).not.toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'MCP 权限校验' })).toBeVisible()
    expect(screen.getByRole('button', { name: '关闭 MCP 权限校验' })).toHaveFocus()
  })

  it('closes with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<InspectorHarness onClose={onClose} />)

    const trigger = screen.getByRole('button', { name: '查看任务' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes from its close button and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(<InspectorHarness />)

    const trigger = screen.getByRole('button', { name: '查看任务' })
    await user.click(trigger)
    await user.click(
      screen.getByRole('button', { name: '关闭 MCP 权限校验' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('removes its Escape listener when unmounted', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<InspectorHarness onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '查看任务' }))
    unmount()
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores focus by id when the captured trigger node was replaced', async () => {
    const user = userEvent.setup()
    render(<ReplacedTriggerHarness />)

    const originalTrigger = screen.getByRole('button', {
      name: '打开可替换触发点',
    })
    await user.click(originalTrigger)
    await user.click(
      screen.getByRole('button', { name: '替换触发点节点' }),
    )
    const replacementTrigger = screen.getByRole('button', {
      name: '替换后的触发点',
    })
    expect(replacementTrigger).not.toBe(originalTrigger)
    await user.click(
      screen.getByRole('button', { name: '关闭 可替换实体' }),
    )

    expect(replacementTrigger).toHaveFocus()
  })
})
