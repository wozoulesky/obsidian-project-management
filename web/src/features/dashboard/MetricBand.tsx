import type { DashboardSnapshot } from '../../data/domain'

export function MetricBand({
  metrics,
}: {
  metrics: DashboardSnapshot['metrics']
}) {
  const completionRate =
    metrics.totalTasks === 0
      ? 0
      : Math.round((metrics.completedTasks / metrics.totalTasks) * 100)
  const metricItems = [
    {
      label: '任务完成率',
      value: `${completionRate}%`,
      detail: `${metrics.completedTasks} / ${metrics.totalTasks} 项`,
    },
    {
      label: '需求交付',
      value: `${metrics.deliveredRequirements} / ${metrics.totalRequirements}`,
      detail: '已交付 / 总数',
    },
    {
      label: '活跃缺陷',
      value: String(metrics.activeDefects),
      detail: `${metrics.seriousDefects} 个严重`,
    },
    {
      label: '每周速度',
      value: String(metrics.velocityPerWeek),
      detail: '项 / 周',
    },
    {
      label: '活跃协作者',
      value: String(metrics.activeActors),
      detail: `${metrics.activeAgents} 个 Agent`,
    },
  ]

  return (
    <section className="metrics-grid" aria-label="项目指标">
      {metricItems.map(({ detail, label, value }) => (
        <article className="metric-card" key={label}>
          <span className="metric-card__label">{label}</span>
          <strong className="metric-value">{value}</strong>
          <span className="metric-card__detail">{detail}</span>
        </article>
      ))}
    </section>
  )
}
