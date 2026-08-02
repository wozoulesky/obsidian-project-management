import { MetricGrid } from '../../components/layout/MetricGrid'
import type { DashboardSnapshot, Project, RiskItem } from '../../data/domain'

export function MetricBand({
  projects,
  workspaceMetrics,
  risks,
}: {
  projects: Project[]
  workspaceMetrics: DashboardSnapshot['metrics']
  risks: RiskItem[]
}) {
  const activeProjects = projects.filter(
    ({ status }) => status === 'in_progress',
  ).length
  const metricItems = [
    {
      label: '项目总数',
      value: String(projects.length),
      detail: '工作区全部项目',
    },
    {
      label: '活跃项目',
      value: String(activeProjects),
      detail: `${activeProjects} 个进行中`,
    },
    {
      label: '组合开放风险',
      value: String(risks.length),
      detail: `${risks.filter(({ level }) => level === 'critical').length} 项严重`,
    },
    {
      label: '活跃协作者',
      value: String(workspaceMetrics.activeActors),
      detail: `${workspaceMetrics.activeAgents} 个 Agent`,
    },
  ]

  return (
    <section aria-label="项目指标">
      <MetricGrid ariaLabel="全局驾驶舱关键指标">
        {metricItems.map(({ detail, label, value }) => (
          <article className="metric-card dashboard-metric" key={label}>
            <span className="metric-card__label">{label}</span>
            <strong className="metric-value">{value}</strong>
            <span className="metric-card__detail">{detail}</span>
          </article>
        ))}
      </MetricGrid>
    </section>
  )
}
