import type { Deliverable } from '../../data/domain'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { Badge } from '../../components/ui/Badge'

type RecentDeliverablesProps = {
  dataUpdatedAt?: number
  deliverables?: Deliverable[]
  error?: unknown
  isError?: boolean
  isFetching?: boolean
  isPending?: boolean
  onRetry?: () => unknown
}

export function RecentDeliverables({
  dataUpdatedAt,
  deliverables,
  error,
  isError = false,
  isFetching = false,
  isPending = false,
  onRetry = () => undefined,
}: RecentDeliverablesProps) {
  return (
    <section aria-label="最近交付物" className="dashboard-card relay-card">
      <div className="dashboard-card__header">
        <div>
          <p className="dashboard-card__eyebrow">DELIVERABLES</p>
          <h3>最近交付物</h3>
        </div>
        <Badge>{deliverables?.length ?? 0} 项</Badge>
      </div>
      {isPending && deliverables === undefined ? (
        <LoadingState label="正在加载最近交付物" />
      ) : isError && deliverables === undefined ? (
        <ErrorState
          error={error}
          isRetrying={isFetching}
          onRetry={onRetry}
        />
      ) : deliverables?.length ? (
        <>
          <RefreshState
            dataUpdatedAt={dataUpdatedAt}
            error={error}
            isError={isError}
            isFetching={isFetching}
            label="正在刷新最近交付物"
          />
          <ol className="recent-deliverables">
            {deliverables.map((deliverable) => (
              <li className="recent-deliverables__item" key={deliverable.id}>
                <div className="recent-deliverables__heading">
                  <strong>{deliverable.title}</strong>
                  <Badge>{deliverable.kind}</Badge>
                </div>
                <code>{deliverable.ref}</code>
                {deliverable.note ? <p>{deliverable.note}</p> : null}
                <span>{deliverable.createdBy.name}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <EmptyState title="当前还没有交付物" />
      )}
    </section>
  )
}
