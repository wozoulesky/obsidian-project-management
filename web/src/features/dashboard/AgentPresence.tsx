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
  onRetry = () => undefined,
  sessions,
}: RelayStateProps & { sessions?: Session[] }) {
  return (
    <section aria-label="Agent 会话" className="dashboard-card relay-card">
      <div className="dashboard-card__header">
        <div>
          <p className="dashboard-card__eyebrow">PRESENCE</p>
          <h3>现场会话</h3>
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
                <div className="agent-presence__heading">
                  <strong>{session.agent.name}</strong>
                  <Badge
                    tone={
                      session.status === 'abandoned' ? 'warning' : 'primary'
                    }
                  >
                    {session.status === 'abandoned' ? '已离场' : '进行中'}
                  </Badge>
                </div>
                <p>{session.intent}</p>
                <div className="agent-presence__meta">
                  <span>{session.taskIds.length} 个认领任务</span>
                  <time dateTime={session.lastActiveAt}>
                    最后活跃 {hongKongDateTime(session.lastActiveAt)}
                  </time>
                </div>
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
