import type { Handoff } from '../../data/domain'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'

type LatestHandoffProps = {
  dataUpdatedAt?: number
  error?: unknown
  handoff?: Handoff | null
  isError?: boolean
  isFetching?: boolean
  isPending?: boolean
  onRetry?: () => unknown
}

function HandoffList({
  empty,
  items,
  title,
}: {
  empty: string
  items: string[]
  title: string
}) {
  return (
    <div className="handoff-list">
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </div>
  )
}

export function LatestHandoff({
  dataUpdatedAt,
  error,
  handoff,
  isError = false,
  isFetching = false,
  isPending = false,
  onRetry = () => undefined,
}: LatestHandoffProps) {
  return (
    <section aria-label="最新交接" className="dashboard-card relay-card">
      <div className="dashboard-card__header">
        <div>
          <p className="dashboard-card__eyebrow">LATEST HANDOFF</p>
          <h3>最新交接</h3>
        </div>
      </div>
      {isPending && handoff === undefined ? (
        <LoadingState label="正在加载最新交接" />
      ) : isError && handoff === undefined ? (
        <ErrorState
          error={error}
          isRetrying={isFetching}
          onRetry={onRetry}
        />
      ) : handoff ? (
        <div className="latest-handoff">
          <RefreshState
            dataUpdatedAt={dataUpdatedAt}
            error={error}
            isError={isError}
            isFetching={isFetching}
            label="正在刷新最新交接"
          />
          <p className="latest-handoff__summary">{handoff.summary}</p>
          <div className="latest-handoff__lists">
            <HandoffList
              empty="暂无完成项"
              items={handoff.done}
              title="已完成"
            />
            <HandoffList
              empty="暂无阻塞项"
              items={handoff.blockers}
              title="阻塞项"
            />
            <HandoffList
              empty="暂无下一步"
              items={handoff.nextSteps}
              title="下一步"
            />
          </div>
        </div>
      ) : (
        <EmptyState title="当前还没有交接记录" />
      )}
    </section>
  )
}
