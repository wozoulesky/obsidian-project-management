import { StatusDonut } from '../../components/charts/StatusDonut'
import { TrendChart } from '../../components/charts/TrendChart'
import { EmptyState } from '../../components/data/DataState'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { DashboardSnapshot, Project } from '../../data/domain'

const projectStatusLabels: Record<Project['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  on_hold: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
}

export function PortfolioHealthStage({
  projects,
  snapshot,
}: {
  projects: Project[]
  snapshot: DashboardSnapshot
}) {
  const completionRate = snapshot.metrics.totalTasks === 0
    ? 0
    : Math.round(
        snapshot.metrics.completedTasks / snapshot.metrics.totalTasks * 100,
      )
  const latestTrend = snapshot.trend.at(-1)

  return (
    <GlassPanel
      ariaLabel="项目组合健康签名"
      className="portfolio-health-stage"
    >
      <div className="dashboard-panel-heading">
        <div>
          <p className="dashboard-card__eyebrow">PORTFOLIO HEALTH</p>
          <h2>项目组合健康签名</h2>
          <p>趋势、任务状态与项目进度均来自当前查询快照。</p>
        </div>
        {latestTrend ? (
          <span className="dashboard-card__summary tabular-numerals">
            {latestTrend.actual} 项已完成
          </span>
        ) : null}
      </div>

      <div className="portfolio-health-stage__visuals">
        <section aria-label="当前项目交付趋势" className="health-chart-card">
          <h3>交付趋势</h3>
          <TrendChart points={snapshot.trend} />
        </section>
        <section aria-label="当前项目任务状态" className="health-chart-card">
          <h3>任务状态</h3>
          <StatusDonut
            completionRate={completionRate}
            counts={snapshot.taskStatusCounts}
          />
        </section>
      </div>

      <section aria-label="真实项目进度" className="portfolio-health-stage__projects">
        <div className="dashboard-panel-heading dashboard-panel-heading--compact">
          <h3>项目进度</h3>
          <span>{projects.length} 个项目</span>
        </div>
        {projects.length ? (
          <ul className="portfolio-health-lanes">
            {projects.map((project) => (
              <li key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{projectStatusLabels[project.status]}</span>
                </div>
                <progress
                  aria-label={`${project.name}进度`}
                  max="100"
                  value={project.progress}
                >
                  {project.progress}%
                </progress>
                <span className="tabular-numerals">{project.progress}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            action={<span>创建项目后，这里会展示真实项目进度。</span>}
            title="暂无项目组合数据"
          />
        )}
      </section>
    </GlassPanel>
  )
}
