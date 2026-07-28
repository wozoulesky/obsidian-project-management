import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
  StaleDataBanner,
  SyncState,
} from './DataState'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('shared project data states', () => {
  it('renders an accessible default loading skeleton and accepts a custom label', () => {
    const { rerender } = render(<LoadingState />)

    expect(
      screen.getByRole('status', { name: '正在加载项目数据' }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(document.querySelectorAll('.data-state__skeleton-line').length)
      .toBeGreaterThan(0)

    rerender(<LoadingState label="正在加载排期" />)
    expect(
      screen.getByRole('status', { name: '正在加载排期' }),
    ).toBeInTheDocument()
  })

  it('normalizes unknown errors without exposing stack details and retries', async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    const error = new Error('数据库文件不可访问')
    error.stack = 'private-file-system-stack'
    const { rerender } = render(
      <ErrorState error={error} onRetry={retry} />,
    )

    expect(
      screen.getByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeInTheDocument()
    expect(screen.getByText('数据库文件不可访问')).toBeInTheDocument()
    expect(screen.queryByText(/private-file-system-stack/)).not
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()

    rerender(
      <ErrorState error={{ stack: 'secret' }} isRetrying onRetry={retry} />,
    )
    expect(screen.getByText('读取项目数据时发生未知错误。'))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正在重试…' })).toBeDisabled()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('renders a semantic empty section with an optional action', () => {
    render(
      <EmptyState
        action={<button type="button">创建任务</button>}
        title="当前项目暂无任务"
      />,
    )

    const empty = screen.getByRole('region', { name: '当前项目暂无任务' })
    expect(empty.tagName).toBe('SECTION')
    expect(screen.getByRole('button', { name: '创建任务' })).toBeVisible()
  })

  it('only marks valid timestamps older than five minutes as stale', () => {
    const now = Date.UTC(2026, 6, 28, 8, 0, 0)
    const updatedAt = Date.UTC(2026, 6, 28, 2, 42, 0)
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    const { rerender } = render(
      <StaleDataBanner dataUpdatedAt={updatedAt} now={now} />,
    )
    expect(setInterval).not.toHaveBeenCalled()
    const stale = screen.getByText(/数据可能已过期/)
    expect(stale).toHaveTextContent('数据可能已过期 · 最后更新 10:42')
    expect(stale.querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-07-28T02:42:00.000Z',
    )

    rerender(
      <StaleDataBanner dataUpdatedAt={now - 5 * 60_000} now={now} />,
    )
    expect(screen.queryByText('数据可能已过期')).not.toBeInTheDocument()

    rerender(<StaleDataBanner dataUpdatedAt={0} now={now} />)
    expect(screen.queryByText('数据可能已过期')).not.toBeInTheDocument()

    rerender(<StaleDataBanner dataUpdatedAt={Number.NaN} now={now} />)
    expect(screen.queryByText('数据可能已过期')).not.toBeInTheDocument()
  })

  it('updates freshness every minute when now is not injected and clears its timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'))
    const clearInterval = vi.spyOn(globalThis, 'clearInterval')
    const updatedAt = Date.now()
    const { unmount } = render(
      <StaleDataBanner dataUpdatedAt={updatedAt} />,
    )
    expect(screen.queryByText(/数据可能已过期/)).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(6 * 60_000)
    })
    expect(screen.getByText(/数据可能已过期/)).toBeInTheDocument()

    unmount()
    expect(clearInterval).toHaveBeenCalled()
  })

  it('re-evaluates a changed data timestamp against an injected clock', () => {
    const now = Date.UTC(2026, 6, 28, 8, 0, 0)
    const { rerender } = render(
      <StaleDataBanner dataUpdatedAt={now - 6 * 60_000} now={now} />,
    )
    expect(screen.getByText(/数据可能已过期/)).toBeInTheDocument()

    rerender(
      <StaleDataBanner dataUpdatedAt={now - 60_000} now={now} />,
    )
    expect(screen.queryByText(/数据可能已过期/)).not.toBeInTheDocument()
  })

  it('announces background refresh and reports a failed refresh non-destructively', () => {
    const { rerender } = render(
      <RefreshState dataUpdatedAt={1} isFetching now={2} />,
    )
    expect(
      screen.getByRole('status', { name: '正在刷新项目数据' }),
    ).toBeInTheDocument()

    rerender(
      <RefreshState
        dataUpdatedAt={1}
        error={new Error('数据库文件不可访问')}
        isError
        now={2}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '刷新失败，正在显示上次数据。数据库文件不可访问',
    )

    rerender(<SyncState isFetching />)
    expect(
      screen.getByRole('status', { name: '正在同步项目数据' }),
    ).toBeInTheDocument()
  })
})
