import { useState, type ReactNode } from 'react'

const STALE_AFTER_MS = 5 * 60_000
const UNKNOWN_ERROR_MESSAGE = '读取项目数据时发生未知错误。'

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : UNKNOWN_ERROR_MESSAGE
}

export function LoadingState({
  label = '正在加载项目数据',
}: {
  label?: string
}) {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className="data-state data-state--loading"
      role="status"
    >
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className="data-state__skeleton">
        <span className="data-state__skeleton-line data-state__skeleton-line--title" />
        <span className="data-state__skeleton-line" />
        <span className="data-state__skeleton-line data-state__skeleton-line--short" />
      </div>
    </section>
  )
}

export function ErrorState({
  error,
  isRetrying = false,
  onRetry,
}: {
  error: unknown
  isRetrying?: boolean
  onRetry: () => unknown
}) {
  return (
    <section
      aria-label="无法读取本地项目数据"
      className="data-state data-state--error"
      role="alert"
    >
      <h2>无法读取本地项目数据</h2>
      <p>{errorMessage(error)}</p>
      <button
        className="button button--primary"
        disabled={isRetrying}
        onClick={onRetry}
        type="button"
      >
        {isRetrying ? '正在重试…' : '重试'}
      </button>
    </section>
  )
}

export function EmptyState({
  action,
  title,
}: {
  action?: ReactNode
  title: string
}) {
  return (
    <section
      aria-label={title}
      className="data-state data-state--empty"
    >
      <p>{title}</p>
      {action ? <div className="data-state__action">{action}</div> : null}
    </section>
  )
}

export function StaleDataBanner({
  dataUpdatedAt,
  now,
}: {
  dataUpdatedAt: number
  now?: number
}) {
  const [renderedAt] = useState(Date.now)
  const currentTime = now ?? renderedAt
  const isValid =
    Number.isFinite(dataUpdatedAt) &&
    dataUpdatedAt > 0 &&
    Number.isFinite(currentTime)
  if (!isValid || currentTime - dataUpdatedAt <= STALE_AFTER_MS) {
    return null
  }

  return (
    <p className="data-state__stale" role="status">
      数据可能已过期
    </p>
  )
}

type RefreshStateProps = {
  dataUpdatedAt?: number
  error?: unknown
  isError?: boolean
  isFetching?: boolean
  label?: string
  now?: number
}

export function RefreshState({
  dataUpdatedAt = 0,
  error,
  isError = false,
  isFetching = false,
  label = '正在刷新项目数据',
  now,
}: RefreshStateProps) {
  return (
    <>
      {isFetching ? (
        <p
          aria-label={label}
          className="data-state__refresh"
          role="status"
        >
          {label}
        </p>
      ) : null}
      {isError ? (
        <p className="data-state__refresh-error" role="alert">
          刷新失败，正在显示上次数据。{errorMessage(error)}
        </p>
      ) : null}
      <StaleDataBanner dataUpdatedAt={dataUpdatedAt} now={now} />
    </>
  )
}

export function SyncState(props: Omit<RefreshStateProps, 'label'>) {
  return <RefreshState {...props} label="正在同步项目数据" />
}
