import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'
import { GlassPanel } from '../../components/ui/GlassPanel'
import {
  useActors,
  useAllTasks,
  useProjects,
} from '../../data/query-hooks'
import type { Task } from '../../data/domain'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ProjectCard } from './ProjectCard'
import { ProjectSummaryPanel } from './ProjectSummaryPanel'
import { projectRisk } from './project-risk'
import './projects-glass.css'

export function ProjectPage() {
  const projectsQuery = useProjects()
  const actorsQuery = useActors()
  const tasksQuery = useAllTasks()
  const [searchParams, setSearchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  )
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const ownerId = searchParams.get('owner') ?? ''
  const search = searchParams.get('q') ?? ''
  const actors = useMemo(() => actorsQuery.data ?? [], [actorsQuery.data])
  const activeActors = actors.filter(({ status }) => status === 'active')
  const actorById = useMemo(
    () => new Map(actors.map((actor) => [actor.id, actor])),
    [actors],
  )

  const updateFilter = (key: 'owner' | 'q', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const taskCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasksQuery.data ?? []) {
      if (!task.projectId) continue
      counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1)
    }
    return counts
  }, [tasksQuery.data])

  const tasksByProject = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const task of tasksQuery.data ?? []) {
      if (!task.projectId) continue
      const tasks = grouped.get(task.projectId) ?? []
      tasks.push(task)
      grouped.set(task.projectId, tasks)
    }
    return grouped
  }, [tasksQuery.data])

  const filteredProjects = (projectsQuery.data ?? [])
    .filter((project) => {
      const haystack = [
        project.name,
        project.code,
        actorById.get(project.ownerId)?.name ?? '',
      ].join(' ').toLocaleLowerCase()
      return (
        (!ownerId || project.ownerId === ownerId)
        && (!search || haystack.includes(search.trim().toLocaleLowerCase()))
      )
    })
    .sort((left, right) => {
      const rank = (project: typeof left) => {
        const risk = projectRisk(project)
        return risk === '已逾期' ? 0 : risk === '7 天内到期' ? 1 : 2
      }
      return (
        rank(left) - rank(right)
        || (left.dueDate ?? '9999-12-31').localeCompare(
          right.dueDate ?? '9999-12-31',
        )
        || left.name.localeCompare(right.name)
      )
    })

  const queries = [projectsQuery, actorsQuery, tasksQuery]
  const initialErrorQuery = queries.find(
    (query) => query.isError && query.data === undefined,
  )
  const isPending = !initialErrorQuery && queries.some((query) => query.isPending)
  const error = initialErrorQuery?.error
    ?? projectsQuery.error
    ?? actorsQuery.error
    ?? tasksQuery.error
  const retry = () => {
    void projectsQuery.refetch()
    void actorsQuery.refetch()
    void tasksQuery.refetch()
  }
  const closeDialog = () => {
    setDialogOpen(false)
    openerRef.current?.focus()
  }
  const selectedProject = filteredProjects.find(
    ({ id }) => id === selectedProjectId,
  ) ?? null

  return (
    <section aria-labelledby="project-page-title" className="project-page">
      <PageHeader
        actions={(
          <Button
            onClick={(event) => {
              openerRef.current = event.currentTarget
              setDialogOpen(true)
            }}
            variant="primary"
          >
            新建项目
          </Button>
        )}
        eyebrow="PROJECT MATRIX"
        subtitle="按负责人和关键词筛选真实项目，并在不离开矩阵的情况下查看摘要。"
        title={<span id="project-page-title">全部项目</span>}
      />

      <div className="project-page__filters">
        <div aria-label="按负责人筛选" className="project-page__owners" role="group">
          <button
            aria-pressed={!ownerId}
            onClick={() => updateFilter('owner', '')}
            type="button"
          >
            全部负责人
          </button>
          {activeActors.map((actor) => (
            <button
              aria-pressed={ownerId === actor.id}
              key={actor.id}
              onClick={() => updateFilter('owner', actor.id)}
              type="button"
            >
              {actor.name}
            </button>
          ))}
        </div>
        <label>
          <span className="visually-hidden">搜索项目</span>
          <input
            aria-label="搜索项目"
            onChange={(event) => updateFilter('q', event.target.value)}
            placeholder="搜索名称、编号或负责人"
            type="search"
            value={search}
          />
        </label>
      </div>

      {isPending ? <LoadingState label="正在加载项目" /> : null}
      {!isPending && initialErrorQuery ? (
        <ErrorState error={error} onRetry={retry} />
      ) : null}
      {!isPending && !initialErrorQuery ? (
        <>
          <RefreshState
            dataUpdatedAt={Math.min(
              projectsQuery.dataUpdatedAt,
              actorsQuery.dataUpdatedAt,
              tasksQuery.dataUpdatedAt,
            )}
            error={error}
            isError={queries.some((query) => query.isError)}
            isFetching={queries.some((query) => query.isFetching)}
          />
          {filteredProjects.length > 0 ? (
            <div className="project-portfolio-layout">
              <GlassPanel ariaLabel="玻璃项目矩阵" className="project-matrix-panel">
                <div className="project-matrix-panel__heading">
                  <div>
                    <h2>玻璃项目矩阵</h2>
                    <span>{filteredProjects.length} / {projectsQuery.data?.length ?? 0} 个项目</span>
                  </div>
                </div>
                <div className="project-matrix-scroll" tabIndex={0}>
                  <div className="project-grid">
                    {filteredProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        onSelect={() => setSelectedProjectId(project.id)}
                        owner={actorById.get(project.ownerId)}
                        project={project}
                        selected={selectedProjectId === project.id}
                        taskCount={taskCounts.get(project.id) ?? 0}
                      />
                    ))}
                  </div>
                </div>
              </GlassPanel>
              <ProjectSummaryPanel
                owner={
                  selectedProject
                    ? actorById.get(selectedProject.ownerId)
                    : undefined
                }
                project={selectedProject}
                tasks={
                  selectedProject
                    ? tasksByProject.get(selectedProject.id) ?? []
                    : []
                }
              />
            </div>
          ) : (
            <EmptyState title="没有符合当前筛选条件的项目" />
          )}
        </>
      ) : null}

      {dialogOpen ? (
        <CreateProjectDialog
          activeActors={activeActors}
          onClose={closeDialog}
        />
      ) : null}
    </section>
  )
}
