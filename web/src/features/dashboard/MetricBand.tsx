import { MetricGrid } from '../../components/layout/MetricGrid'
import type { DashboardSnapshot, Project, RiskItem } from '../../data/domain'

export function MetricBand({
  metrics,
  projects,
  risks,
}: {
  metrics: DashboardSnapshot['metrics']
  projects: Project[]
  risks: RiskItem[]
}) {
  const completionRate =
    metrics.totalTasks === 0
      ? 0
      : Math.round((metrics.completedTasks / metrics.totalTasks) * 100)
  const metricItems = [
    {
      label: '项目总数',
      value: String(projects.length),
      detail: `${projects.filter(({ status }) => status === 'in_progress').length} 个进行中`,
    },
    {
      label: '当前项目任务完成率',
      value: `${completionRate}%`,
      detail: `${metrics.completedTasks} / ${metrics.totalTasks} 项`,
    },
    {
      label: '当前项目待处理风险',
      value: String(risks.length),
      detail: `${risks.filter(({ level }) => level === 'critical').length} 项严重`,
    },
    {
      label: '当前项目活跃协作者',
      value: String(metrics.activeActors),
      detail: `${metrics.activeAgents} 个 Agent`,
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
