import { useState } from 'react'

import { StatusDonut } from '../../components/charts/StatusDonut'
import { TrendChart } from '../../components/charts/TrendChart'
import {
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { Badge } from '../../components/ui/Badge'
import type { RiskItem } from '../../data/domain'
import {
  useDashboard,
  useProjectDeliverables,
  useProjectHandoffs,
  useProjectRepository,
  useProjectSessions,
} from '../../data/query-hooks'
import { ActivityFeed } from './ActivityFeed'
import { AgentPresence } from './AgentPresence'
import { LatestHandoff } from './LatestHandoff'
import { MetricBand } from './MetricBand'
import { RecentDeliverables } from './RecentDeliverables'
import { RiskBanner } from './RiskBanner'
import { RiskQueue } from './RiskQueue'

type DashboardPeriod = 7 | 30 | 90

const periods: DashboardPeriod[] = [7, 30, 90]

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>(30)
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)
  const { projectId } = useProjectRepository()
  const dashboard = useDashboard(period)
  const sessions = useProjectSessions(projectId)
  const handoffs = useProjectHandoffs(projectId)
  const deliverables = useProjectDeliverables(projectId)
  const snapshot = dashboard.data
  const selectedRisk =
    snapshot?.risks.find((risk) => risk.id === selectedRiskId) ?? null

  if (dashboard.isError && !snapshot) {
    return (
      <section className="dashboard-page">
        <ErrorState
          error={dashboard.error}
          isRetrying={dashboard.isFetching}
          onRetry={() => dashboard.refetch()}
        />
      </section>
    )
  }

  if (dashboard.isPending && !snapshot) {
    return (
      <section className="dashboard-page">
        <LoadingState />
      </section>
    )
  }
  if (!snapshot) return null

  const completionRate =
    snapshot.metrics.totalTasks === 0
      ? 0
      : Math.round(
          (snapshot.metrics.completedTasks / snapshot.metrics.totalTasks) *
            100,
        )
  const latestTrend = snapshot.trend.at(-1)

  return (
    <section className="dashboard-page">
      <RefreshState
        dataUpdatedAt={dashboard.dataUpdatedAt}
        error={dashboard.error}
        isError={dashboard.isError}
        isFetching={dashboard.isFetching}
      />
      <header className="dashboard-page__header">
        <div>
          <p className="dashboard-page__eyebrow">PROJECT HEALTH</p>
          <h1>仪表盘</h1>
        </div>
        <div className="period-control" aria-label="趋势时间范围">
          {periods.map((days) => (
            <button
              aria-pressed={period === days}
              className="period-control__button"
              key={days}
              onClick={() => setPeriod(days)}
              type="button"
            >
              {days} 天
            </button>
          ))}
        </div>
      </header>

      <RiskBanner risks={snapshot.risks} />
      <MetricBand metrics={snapshot.metrics} />

      <section aria-label="Agent 现场" className="dashboard-relay">
        <div className="dashboard-relay__header">
          <div>
            <p className="dashboard-page__eyebrow">AGENT RELAY</p>
            <h2>Agent 现场</h2>
          </div>
          <Badge tone="primary">
            {sessions.data?.filter(({ status }) => status === 'active')
              .length ?? 0}{' '}
            个在线
          </Badge>
        </div>
        <div className="dashboard-relay__grid">
          <AgentPresence
            dataUpdatedAt={sessions.dataUpdatedAt}
            error={sessions.error}
            isError={sessions.isError}
            isFetching={sessions.isFetching}
            isPending={sessions.isPending}
            onRetry={() => sessions.refetch()}
            sessions={sessions.data}
          />
          <LatestHandoff
            dataUpdatedAt={handoffs.dataUpdatedAt}
            error={handoffs.error}
            handoff={
              handoffs.data === undefined ? undefined : handoffs.data[0] ?? null
            }
            isError={handoffs.isError}
            isFetching={handoffs.isFetching}
            isPending={handoffs.isPending}
            onRetry={() => handoffs.refetch()}
          />
          <RecentDeliverables
            dataUpdatedAt={deliverables.dataUpdatedAt}
            deliverables={deliverables.data}
            error={deliverables.error}
            isError={deliverables.isError}
            isFetching={deliverables.isFetching}
            isPending={deliverables.isPending}
            onRetry={() => deliverables.refetch()}
          />
        </div>
      </section>

      <div className="dashboard-layout dashboard-layout--charts">
        <section className="dashboard-card dashboard-main">
          <div className="dashboard-card__header">
            <div>
              <p className="dashboard-card__eyebrow">DELIVERY TREND</p>
              <h2>完成趋势</h2>
            </div>
            {latestTrend ? (
              <span className="dashboard-card__summary tabular-numerals">
                {latestTrend.actual} 项已完成
              </span>
            ) : null}
          </div>
          <TrendChart points={snapshot.trend} />
        </section>

        <section className="dashboard-card dashboard-status">
          <div className="dashboard-card__header">
            <div>
              <p className="dashboard-card__eyebrow">TASK STATUS</p>
              <h2>状态分布</h2>
            </div>
          </div>
          <StatusDonut
            completionRate={completionRate}
            counts={snapshot.taskStatusCounts}
          />
        </section>
      </div>

      <section className="dashboard-card dashboard-risk-section">
        <div className="dashboard-card__header">
          <div>
            <p className="dashboard-card__eyebrow">RISK QUEUE</p>
            <h2>风险队列</h2>
          </div>
          <Badge tone="critical">{snapshot.risks.length} 项</Badge>
        </div>
        <div
          className={
            selectedRisk ? 'data-grid-with-inspector' : undefined
          }
        >
          <RiskQueue
            risks={snapshot.risks}
            onSelect={(risk: RiskItem) => setSelectedRiskId(risk.id)}
          />
          {selectedRisk ? (
            <aside
              aria-label="风险详情"
              className="inspector risk-inspector"
            >
              <div className="risk-inspector__heading">
                <h3>{selectedRisk.title}</h3>
                <Badge tone={selectedRisk.level}>
                  {selectedRisk.level === 'critical' ? '严重' : '预警'}
                </Badge>
              </div>
              <dl>
                <div>
                  <dt>负责人</dt>
                  <dd>{selectedRisk.assignee.name}</dd>
                </div>
                <div>
                  <dt>进度</dt>
                  <dd className="tabular-numerals">
                    {selectedRisk.progress}%
                  </dd>
                </div>
                <div>
                  <dt>截止</dt>
                  <dd className="tabular-numerals">
                    {selectedRisk.dueDate}
                  </dd>
                </div>
              </dl>
            </aside>
          ) : null}
        </div>
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card__header">
          <div>
            <p className="dashboard-card__eyebrow">RECENT ACTIVITY</p>
            <h2>最近活动</h2>
          </div>
        </div>
        <ActivityFeed activities={snapshot.activities} />
      </section>
    </section>
  )
}
