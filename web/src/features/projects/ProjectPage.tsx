import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
} from '../../components/data/DataState'
import { Button } from '../../components/ui/Button'
import {
  useActors,
  useProjects,
} from '../../data/query-hooks'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ProjectCard } from './ProjectCard'

export function ProjectPage() {
  const projectsQuery = useProjects()
  const actorsQuery = useActors()
  const [searchParams, setSearchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
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

  const filteredProjects = (projectsQuery.data ?? []).filter((project) => {
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

  const isPending = projectsQuery.isPending || actorsQuery.isPending
  const error = projectsQuery.error ?? actorsQuery.error
  const retry = () => {
    void projectsQuery.refetch()
    void actorsQuery.refetch()
  }

  return (
    <section aria-labelledby="project-page-title" className="project-page">
      <header className="project-page__header">
        <div>
          <p className="project-page__eyebrow">PROJECTS</p>
          <h1 id="project-page-title">全部项目</h1>
        </div>
        <Button onClick={() => setDialogOpen(true)} variant="primary">
          新建项目
        </Button>
      </header>

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
      {!isPending && error && projectsQuery.data === undefined ? (
        <ErrorState error={error} onRetry={retry} />
      ) : null}
      {!isPending && !error ? (
        <>
          <RefreshState
            dataUpdatedAt={Math.min(
              projectsQuery.dataUpdatedAt,
              actorsQuery.dataUpdatedAt,
            )}
            error={projectsQuery.error ?? actorsQuery.error}
            isError={projectsQuery.isError || actorsQuery.isError}
            isFetching={projectsQuery.isFetching || actorsQuery.isFetching}
          />
          {filteredProjects.length > 0 ? (
            <div className="project-grid">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  owner={actorById.get(project.ownerId)}
                  project={project}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="没有符合当前筛选条件的项目" />
          )}
        </>
      ) : null}

      {dialogOpen ? (
        <CreateProjectDialog
          activeActors={activeActors}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </section>
  )
}
