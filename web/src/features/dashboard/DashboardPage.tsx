import { useState } from 'react'

import {
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { PageHeader } from '../../components/layout/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { GlassPanel } from '../../components/ui/GlassPanel'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { RiskItem } from '../../data/domain'
import {
  useDashboard,
  useProjectDeliverables,
  useProjectHandoffs,
  useProjectRepository,
  useProjectSessions,
  useProjects,
} from '../../data/query-hooks'
import { ActivityFeed } from './ActivityFeed'
import { AgentPresence } from './AgentPresence'
import { LatestHandoff } from './LatestHandoff'
import { MetricBand } from './MetricBand'
import { PortfolioHealthStage } from './PortfolioHealthStage'
import { RecentDeliverables } from './RecentDeliverables'
import { RiskBanner } from './RiskBanner'
import { RiskQueue } from './RiskQueue'
import './dashboard-glass.css'

type DashboardPeriod = 7 | 30 | 90

const periods: DashboardPeriod[] = [7, 30, 90]
const periodOptions = periods.map((days) => ({
  label: `${days} 天`,
  value: String(days),
}))

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>(30)
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)
  const { projectId } = useProjectRepository()
  const dashboard = useDashboard(period)
  const projects = useProjects()
  const sessions = useProjectSessions(projectId)
  const handoffs = useProjectHandoffs(projectId)
  const deliverables = useProjectDeliverables(projectId)
  const snapshot = dashboard.data
  const portfolio = projects.data
  const selectedRisk =
    snapshot?.risks.find((risk) => risk.id === selectedRiskId) ?? null

  const initialErrorQuery = [dashboard, projects].find(
    (query) => query.isError && query.data === undefined,
  )
  const initialError = initialErrorQuery?.error
  const retryOverview = () => {
    void dashboard.refetch()
    void projects.refetch()
  }

  if (initialErrorQuery) {
    return (
      <section className="dashboard-page">
        <ErrorState
          error={initialError}
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
        subtitle="跨项目查看组合进度；健康、风险、协作与活动来自当前工作区项目范围。"
        title="全局驾驶舱"
      />

      <RiskBanner risks={snapshot.risks} />
      <MetricBand
        metrics={snapshot.metrics}
        projects={portfolio}
        risks={snapshot.risks}
      />
      <PortfolioHealthStage projects={portfolio} snapshot={snapshot} />

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

      <GlassPanel ariaLabel="风险工作区" className="dashboard-risk-section">
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
      </GlassPanel>

      <GlassPanel ariaLabel="当前项目活动" className="dashboard-activity-panel">
        <div className="dashboard-card__header">
          <div>
            <p className="dashboard-card__eyebrow">RECENT ACTIVITY</p>
            <h2>最近活动</h2>
          </div>
        </div>
        <ActivityFeed activities={snapshot.activities} />
      </GlassPanel>
    </section>
  )
}
