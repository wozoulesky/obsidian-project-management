import type { Session } from '../../data/domain'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { Badge } from '../../components/ui/Badge'

type RelayStateProps = {
  dataUpdatedAt?: number
  error?: unknown
  isError?: boolean
  isFetching?: boolean
  isPending?: boolean
  onRetry?: () => unknown
}

function hongKongDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Hong_Kong',
  }).format(new Date(value))
}

export function AgentPresence({
  dataUpdatedAt,
  error,
  isError = false,
  isFetching = false,
  isPending = false,
  onSelect,
  onRetry = () => undefined,
  selectedActorId = null,
  sessions,
}: RelayStateProps & {
  onSelect?: (session: Session) => void
  selectedActorId?: string | null
  sessions?: Session[]
}) {
  return (
    <section
      aria-label="协作者状态"
      className="glass-panel dashboard-card relay-card"
    >
      <div className="dashboard-card__header">
        <div>
          <p className="dashboard-card__eyebrow">PRESENCE</p>
          <h2>协作者状态</h2>
        </div>
        <Badge tone="primary">
          {sessions?.filter(({ status }) => status === 'active').length ?? 0}{' '}
          个活跃
        </Badge>
      </div>
      {isPending && sessions === undefined ? (
        <LoadingState label="正在加载 Agent 会话" />
      ) : isError && sessions === undefined ? (
        <ErrorState
          error={error}
          isRetrying={isFetching}
          onRetry={onRetry}
        />
      ) : sessions?.length ? (
        <>
          <RefreshState
            dataUpdatedAt={dataUpdatedAt}
            error={error}
            isError={isError}
            isFetching={isFetching}
            label="正在刷新 Agent 会话"
          />
          <ol className="agent-presence">
            {sessions.map((session) => (
              <li className="agent-presence__item" key={session.id}>
                <button
                  aria-label={`选择协作者：${session.agent.name}`}
                  aria-pressed={selectedActorId === session.agentId}
                  className="dashboard-select-item"
                  onClick={() => onSelect?.(session)}
                  type="button"
                >
                  <span className="dashboard-select-item__heading">
                    <strong>{session.agent.name}</strong>
                    <Badge
                      tone={
                        session.status === 'abandoned' ? 'warning' : 'primary'
                      }
                    >
                      {session.status === 'active' ? '活跃' : '已离场'}
                    </Badge>
                  </span>
                  <span className="dashboard-select-item__description">
                    {session.intent}
                  </span>
                  <span className="dashboard-select-item__meta">
                    <span>{session.taskIds.length} 个认领任务</span>
                    <time dateTime={session.lastActiveAt}>
                      {hongKongDateTime(session.lastActiveAt)}
                    </time>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <EmptyState title="当前没有活跃或离场会话" />
      )}
    </section>
  )
}
