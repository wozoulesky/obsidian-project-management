import { useState } from 'react'

import { EmptyState } from '../../components/data/DataState'
import { GlassPanel } from '../../components/ui/GlassPanel'
import type { Task } from '../../data/domain'
import { deriveMilestones } from './milestone-derivation'

export function MilestoneTrack({ tasks }: { tasks: Task[] }) {
  const milestones = deriveMilestones(tasks)
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    null,
  )
  const selectedMilestone = milestones.find(
    ({ id }) => id === selectedMilestoneId,
  ) ?? milestones[0] ?? null

  return (
    <div className="project-detail__milestone-layout">
      <GlassPanel
        ariaLabel="项目里程碑轨迹"
        className="milestone-track-panel"
      >
        <div className="project-detail-panel-heading">
          <div>
            <p className="project-page__eyebrow">MILESTONE TRACK</p>
            <h2>阶段—里程碑轨迹</h2>
          </div>
          <span>{milestones.length} 个稳定节点 · 选择不切换路由</span>
        </div>
        {milestones.length ? (
          <div
            aria-label="项目里程碑轨迹，可横向滚动"
            className="milestone-track-scroll"
            tabIndex={0}
          >
            <ol className="milestone-track">
              {milestones.map((milestone) => (
                <li className="milestone-track__item" key={milestone.id}>
                  <button
                    aria-label={`查看里程碑 ${milestone.id}`}
                    aria-pressed={selectedMilestone?.id === milestone.id}
                    onClick={() => setSelectedMilestoneId(milestone.id)}
                    type="button"
                  >
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
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <EmptyState title="当前任务没有里程碑标识" />
        )}
      </GlassPanel>
      <GlassPanel ariaLabel="里程碑上下文" className="milestone-context-panel">
        {selectedMilestone ? (
          <>
            <div className="project-detail-panel-heading">
              <div>
                <p className="project-page__eyebrow">MILESTONE CONTEXT</p>
                <h2>{selectedMilestone.id}</h2>
              </div>
              <span className={`milestone-track__status milestone-track__status--${selectedMilestone.status}`}>
                {selectedMilestone.status}
              </span>
            </div>
            <dl className="milestone-context-panel__facts">
              <div><dt>状态</dt><dd>{selectedMilestone.status}</dd></div>
              <div><dt>目标日期</dt><dd>{selectedMilestone.targetDate}</dd></div>
              <div><dt>任务数</dt><dd>{selectedMilestone.taskCount} 项任务</dd></div>
              <div>
                <dt>负责人</dt>
                <dd>{selectedMilestone.assignees.join('、')}</dd>
              </div>
              <div><dt>完成度</dt><dd>{selectedMilestone.progress}%</dd></div>
            </dl>
          </>
        ) : (
          <>
            <h2>里程碑上下文</h2>
            <EmptyState title="当前项目还没有可选择的里程碑" />
          </>
        )}
      </GlassPanel>
    </div>
  )
}
