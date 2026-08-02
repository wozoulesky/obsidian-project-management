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

const shortDate = (date: string) => date.slice(5).replace('-', '/')

export function PortfolioHealthStage({
  projects,
  snapshot,
}: {
  projects: Project[]
  snapshot: DashboardSnapshot
}) {
  const trend = snapshot.trend.slice(-7)
  const paddedTrend = [
    ...Array<undefined>(Math.max(0, 7 - trend.length)).fill(undefined),
    ...trend,
  ]
  const trendMax = Math.max(
    1,
    ...trend.flatMap(({ actual, planned }) => [actual, planned]),
  )
  const latestTrend = trend.at(-1)
  const trendDescription = trend.length
    ? trend.map(({ actual, date, planned }) =>
        `${shortDate(date)} 实际 ${actual}，计划 ${planned}`,
      ).join('；')
    : '暂无趋势数据'

  return (
    <GlassPanel
      ariaLabel="项目组合健康签名"
      className="portfolio-health-stage"
    >
      <div className="dashboard-panel-heading">
        <div>
          <p className="dashboard-card__eyebrow">PORTFOLIO HEALTH</p>
          <h2>项目组合健康签名</h2>
          <p>交付趋势与项目进度来自当前工作区快照。</p>
        </div>
        {latestTrend ? (
          <span className="dashboard-card__summary tabular-numerals">
            {latestTrend.actual} 项已完成
          </span>
        ) : null}
      </div>

      <div className="portfolio-health-stage__body">
        <section aria-label="七期交付趋势" className="health-trend-card">
          <div className="health-trend-card__heading">
            <strong>组合交付趋势</strong>
            <span className="tabular-numerals">
              {latestTrend
                ? `${latestTrend.actual} / 计划 ${latestTrend.planned}`
                : '暂无快照'}
            </span>
          </div>
          <div
            aria-label={`最近七期实际交付柱状图：${trendDescription}`}
            className="health-trend-bars"
            role="img"
          >
            {paddedTrend.map((point, index) => (
              <div className="health-trend-column" key={point?.date ?? index}>
                <div className="health-trend-column__slot">
                  {point ? (
                    <span
                      className="health-trend-column__bar"
                      style={{ height: `${Math.max(4, point.actual / trendMax * 100)}%` }}
                    >
                      <span className="visually-hidden">
                        实际完成 {point.actual}，计划 {point.planned}
                      </span>
                    </span>
                  ) : null}
                </div>
                <span>{point ? shortDate(point.date) : '—'}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="真实项目进度" className="portfolio-health-projects">
          <div className="dashboard-panel-heading dashboard-panel-heading--compact">
            <h3>项目健康轨道</h3>
            <span>{projects.length} 个项目</span>
          </div>
          {projects.length ? (
            <ul className="portfolio-health-lanes">
              {projects.map((project) => (
                <li key={project.id}>
                  <strong title={project.name}>{project.name}</strong>
                  <progress
                    aria-label={`${project.name}进度`}
                    max="100"
                    value={project.progress}
                  >
                    {project.progress}%
                  </progress>
                  <span className="tabular-numerals">
                    {projectStatusLabels[project.status]} · {project.progress}%
                  </span>
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
      </div>
    </GlassPanel>
  )
}
