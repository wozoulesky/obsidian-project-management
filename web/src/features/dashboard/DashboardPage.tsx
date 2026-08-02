import { useState } from 'react'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { PageHeader } from '../../components/layout/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { GlassPanel } from '../../components/ui/GlassPanel'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { Deliverable, RiskItem, Session } from '../../data/domain'
import {
  useProjectDeliverables,
  useProjectRepository,
  useProjectSessions,
  useProjects,
  useWorkspaceDashboard,
} from '../../data/query-hooks'
import { ActivityFeed } from './ActivityFeed'
import { AgentPresence } from './AgentPresence'
import { MetricBand } from './MetricBand'
import { PortfolioHealthStage } from './PortfolioHealthStage'
import './dashboard-glass.css'

type DashboardPeriod = 7 | 30 | 90
type DashboardSelection = {
  type: 'risk' | 'actor'
  id: string
}

const periods: DashboardPeriod[] = [7, 30, 90]
const periodOptions = periods.map((days) => ({
  label: `${days} 天`,
  value: String(days),
}))

const riskLevelWeight: Record<RiskItem['level'], number> = {
  critical: 0,
  warning: 1,
}

function representativeAgentSessions(
  sessions: Session[] | undefined,
): Session[] | undefined {
  if (sessions === undefined) return undefined

  const representatives = new Map<string, Session>()
  for (const session of sessions) {
    const current = representatives.get(session.agentId)
    if (
      current === undefined
      || (session.status === 'active' && current.status !== 'active')
      || (
        (session.status === 'active') === (current.status === 'active')
        && session.lastActiveAt > current.lastActiveAt
      )
    ) {
      representatives.set(session.agentId, session)
    }
  }
  return [...representatives.values()]
}

function priorityRisk(risks: RiskItem[]): RiskItem | undefined {
  return [...risks].sort((left, right) =>
    riskLevelWeight[left.level] - riskLevelWeight[right.level]
    || left.dueDate.localeCompare(right.dueDate)
    || left.id.localeCompare(right.id),
  )[0]
}

function resolveSelection(
  requested: DashboardSelection | null,
  risks: RiskItem[],
  sessions: Session[] | undefined,
): DashboardSelection | null {
  if (
    requested?.type === 'risk'
    && risks.some(({ id }) => id === requested.id)
  ) {
    return requested
  }
  if (
    requested?.type === 'actor'
    && sessions?.some(({ agentId }) => agentId === requested.id)
  ) {
    return requested
  }

  const risk = priorityRisk(risks)
  if (risk) return { type: 'risk', id: risk.id }

  const actor = sessions?.find(({ status }) => status === 'active')
  return actor ? { type: 'actor', id: actor.agentId } : null
}

function DashboardRiskQueue({
  onSelect,
  risks,
  selectedRiskId,
}: {
  onSelect: (risk: RiskItem) => void
  risks: RiskItem[]
  selectedRiskId: string | null
}) {
  return (
    <GlassPanel ariaLabel="风险队列" className="dashboard-risk-panel">
      <div className="dashboard-card__header">
        <div>
          <p className="dashboard-card__eyebrow">RISK QUEUE</p>
          <h2>风险队列</h2>
        </div>
        <Badge tone={risks.length ? 'critical' : 'neutral'}>
          {risks.length} 项
        </Badge>
      </div>
      {risks.length ? (
        <ul className="dashboard-select-list">
          {risks.map((risk) => (
            <li key={risk.id}>
              <button
                aria-label={`选择风险：${risk.title}`}
                aria-pressed={selectedRiskId === risk.id}
                className="dashboard-select-item"
                onClick={() => onSelect(risk)}
                type="button"
              >
                <span className="dashboard-select-item__heading">
                  <strong>{risk.title}</strong>
                  <Badge tone={risk.level}>
                    {risk.level === 'critical' ? '严重' : '预警'}
                  </Badge>
                </span>
                <span className="dashboard-select-item__meta">
                  <span>{risk.assignee.name}</span>
                  <time dateTime={risk.dueDate}>{risk.dueDate}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="风险队列为空" />
      )}
    </GlassPanel>
  )
}

function DashboardContextPanel({
  risk,
  session,
}: {
  risk: RiskItem | null
  session: Session | null
}) {
  return (
    <GlassPanel ariaLabel="上下文摘要" className="dashboard-context">
      {risk ? (
        <>
          <div className="dashboard-card__header">
            <div>
              <p className="dashboard-card__eyebrow">CONTEXT</p>
              <h2>{risk.title}</h2>
            </div>
            <Badge tone={risk.level}>
              {risk.level === 'critical' ? '严重' : '预警'}
            </Badge>
          </div>
          <dl className="dashboard-context__list">
            <div><dt>负责人</dt><dd>{risk.assignee.name}</dd></div>
            <div><dt>进度</dt><dd>{risk.progress}%</dd></div>
            <div><dt>截止日期</dt><dd>{risk.dueDate}</dd></div>
            <div>
              <dt>风险级别</dt>
              <dd>{risk.level === 'critical' ? '严重' : '预警'}</dd>
            </div>
          </dl>
          <p className="dashboard-context__note">
            关联{risk.entityType === 'task' ? '任务' : '事项'}：{risk.entityId}
          </p>
        </>
      ) : session ? (
        <>
          <div className="dashboard-card__header">
            <div>
              <p className="dashboard-card__eyebrow">CONTEXT</p>
              <h2>{session.agent.name}</h2>
            </div>
            <Badge tone={session.status === 'active' ? 'primary' : 'warning'}>
              {session.status === 'active' ? '活跃' : '已离场'}
            </Badge>
          </div>
          <dl className="dashboard-context__list">
            <div>
              <dt>类型</dt>
              <dd>{session.agent.kind === 'agent' ? 'Agent' : '人类协作者'}</dd>
            </div>
            <div><dt>工作负载</dt><dd>{session.taskIds.length} 个认领任务</dd></div>
            <div><dt>当前意图</dt><dd>{session.intent}</dd></div>
            <div><dt>会话状态</dt><dd>{session.status === 'active' ? '进行中' : '已离场'}</dd></div>
          </dl>
          <p className="dashboard-context__note">
            最后活跃：{new Intl.DateTimeFormat('zh-CN', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Hong_Kong',
            }).format(new Date(session.lastActiveAt))}
          </p>
        </>
      ) : (
        <>
          <div className="dashboard-card__header">
            <div>
              <p className="dashboard-card__eyebrow">CONTEXT</p>
              <h2>上下文摘要</h2>
            </div>
          </div>
          <EmptyState title="暂无风险或协作者" />
        </>
      )}
    </GlassPanel>
  )
}

function DashboardDeliverables({
  dataUpdatedAt,
  deliverables,
  error,
  isError,
  isFetching,
  isPending,
  onRetry,
  projectScope,
}: {
  dataUpdatedAt?: number
  deliverables?: Deliverable[]
  error?: unknown
  isError: boolean
  isFetching: boolean
  isPending: boolean
  onRetry: () => unknown
  projectScope: string
}) {
  return (
    <section
      aria-label="最近交付物"
      className="glass-panel dashboard-card relay-card"
    >
      <div className="dashboard-card__header">
        <div>
          <p className="dashboard-card__eyebrow">DELIVERABLES</p>
          <h2>最近交付物</h2>
          <p className="dashboard-card__scope">{projectScope}</p>
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
        <EmptyState title="当前项目还没有交付物" />
      )}
    </section>
  )
}

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>(30)
  const [requestedSelection, setRequestedSelection] =
    useState<DashboardSelection | null>(null)
  const { projectId } = useProjectRepository()
  const dashboard = useWorkspaceDashboard(period)
  const projects = useProjects()
  const sessions = useProjectSessions(projectId)
  const deliverables = useProjectDeliverables(projectId)
  const snapshot = dashboard.data
  const portfolio = projects.data

  const initialErrorQuery = [dashboard, projects].find(
    (query) => query.isError && query.data === undefined,
  )
  const retryOverview = () => {
    void dashboard.refetch()
    void projects.refetch()
  }

  if (initialErrorQuery) {
    return (
      <section className="dashboard-page">
        <ErrorState
          error={initialErrorQuery.error}
          isRetrying={dashboard.isFetching || projects.isFetching}
          onRetry={retryOverview}
        />
      </section>
    )
  }

  if ((dashboard.isPending && !snapshot) || (projects.isPending && !portfolio)) {
    return (
      <section className="dashboard-page">
        <LoadingState />
      </section>
    )
  }
  if (!snapshot || !portfolio) return null

  const actorSessions = representativeAgentSessions(sessions.data)
  const projectName = portfolio.find(({ id }) => id === projectId)?.name
    ?? projectId
  const currentProjectScope = `${projectName} · 当前项目`
  const selection = resolveSelection(
    requestedSelection,
    snapshot.risks,
    actorSessions,
  )
  const selectedRisk = selection?.type === 'risk'
    ? snapshot.risks.find(({ id }) => id === selection.id) ?? null
    : null
  const selectedSession = selection?.type === 'actor'
    ? actorSessions?.find(({ agentId }) => agentId === selection.id) ?? null
    : null
  const overviewError = dashboard.error ?? projects.error

  return (
    <section className="dashboard-page">
      <RefreshState
        dataUpdatedAt={Math.min(
          dashboard.dataUpdatedAt,
          projects.dataUpdatedAt,
        )}
        error={overviewError}
        isError={dashboard.isError || projects.isError}
        isFetching={dashboard.isFetching || projects.isFetching}
      />
      <PageHeader
        actions={(
          <SegmentedControl
            ariaLabel="趋势时间范围"
            onChange={(value) => setPeriod(Number(value) as DashboardPeriod)}
            options={periodOptions}
            value={String(period)}
          />
        )}
        eyebrow="PORTFOLIO OVERVIEW"
        subtitle="项目健康、协作状态与交付风险"
        title="全局驾驶舱"
      />

      <MetricBand
        projects={portfolio}
        risks={snapshot.risks}
        workspaceMetrics={snapshot.metrics}
      />
      <PortfolioHealthStage projects={portfolio} snapshot={snapshot} />

      <div
        className="dashboard-detail-grid"
        data-testid="dashboard-detail-grid"
      >
        <div className="dashboard-ops-grid" data-testid="dashboard-ops-grid">
          <DashboardRiskQueue
            onSelect={(risk) => setRequestedSelection({
              type: 'risk',
              id: risk.id,
            })}
            risks={snapshot.risks}
            selectedRiskId={selection?.type === 'risk' ? selection.id : null}
          />
          <AgentPresence
            dataUpdatedAt={sessions.dataUpdatedAt}
            error={sessions.error}
            isError={sessions.isError}
            isFetching={sessions.isFetching}
            isPending={sessions.isPending}
            onRetry={() => sessions.refetch()}
            onSelect={(session) => setRequestedSelection({
              type: 'actor',
              id: session.agentId,
            })}
            projectScope={currentProjectScope}
            selectedActorId={selection?.type === 'actor' ? selection.id : null}
            sessions={actorSessions}
          />
        </div>
        <DashboardContextPanel
          risk={selectedRisk}
          session={selectedSession}
        />
      </div>

      <div className="dashboard-feed-grid" data-testid="dashboard-feed-grid">
        <DashboardDeliverables
          dataUpdatedAt={deliverables.dataUpdatedAt}
          deliverables={deliverables.data}
          error={deliverables.error}
          isError={deliverables.isError}
          isFetching={deliverables.isFetching}
          isPending={deliverables.isPending}
          onRetry={() => deliverables.refetch()}
          projectScope={currentProjectScope}
        />
        <GlassPanel ariaLabel="活动流" className="dashboard-activity-panel">
          <div className="dashboard-card__header">
            <div>
              <p className="dashboard-card__eyebrow">ACTIVITY</p>
              <h2>活动流</h2>
            </div>
          </div>
          <ActivityFeed activities={snapshot.activities.slice(0, 4)} />
        </GlassPanel>
      </div>
    </section>
  )
}
