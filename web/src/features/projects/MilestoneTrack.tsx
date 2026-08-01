import { EmptyState } from '../../components/data/DataState'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { deriveMilestones } from './milestone-derivation'

export function MilestoneTrack({ tasks }: { tasks: Task[] }) {
  const milestones = deriveMilestones(tasks)

  return (
    <GlassPanel
      ariaLabel="项目里程碑轨迹"
      className="milestone-track-panel"
    >
      <div className="project-detail-panel-heading">
        <div>
          <p className="project-page__eyebrow">MILESTONE TRACK</p>
          <h2>阶段—里程碑轨迹</h2>
        </div>
        <span>{milestones.length} 个任务标签分组</span>
      </div>
      {milestones.length ? (
        <ol className="milestone-track">
          {milestones.map((milestone) => (
            <li className="milestone-track__item" key={milestone.id}>
              <div className="milestone-track__heading">
                <div>
                  <span>{milestone.taskCount} 项任务</span>
                  <h3>{milestone.id}</h3>
                </div>
                <span className={`milestone-track__status milestone-track__status--${milestone.status}`}>
                  {milestone.status}
                </span>
              </div>
              <progress
                aria-label={`${milestone.id}里程碑进度`}
                max="100"
                value={milestone.progress}
              />
              <div className="milestone-track__meta">
                <strong>{milestone.progress}%</strong>
                <time dateTime={milestone.targetDate}>
                  {milestone.targetDate}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="当前任务没有里程碑标识" />
      )}
    </GlassPanel>
  )
}
