import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'

import { LoadingState } from '../components/data/DataState'

const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
)

const TaskPage = lazy(() =>
  import('../features/tasks/TaskPage').then((module) => ({
    default: module.TaskPage,
  })),
)

const RequirementPage = lazy(() =>
  import('../features/requirements/RequirementPage').then((module) => ({
    default: module.RequirementPage,
  })),
)

const DefectPage = lazy(() =>
  import('../features/defects/DefectPage').then((module) => ({
    default: module.DefectPage,
  })),
)

const GanttPage = lazy(() =>
  import('../features/gantt/GanttPage').then((module) => ({
    default: module.GanttPage,
  })),
)

const routes = [
  { path: '/settings', heading: '设置' },
] as const

function PageLoadingFallback({
  className,
  label,
}: {
  className: string
  label: string
}) {
  return (
    <section className={className}>
      <LoadingState label={label} />
    </section>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />
      <Route
        path="/dashboard"
        element={
          <Suspense
            fallback={
              <PageLoadingFallback
                className="dashboard-page"
                label="正在加载仪表盘…"
              />
            }
          >
            <DashboardPage />
          </Suspense>
        }
      />
      <Route
        path="/tasks"
        element={
          <Suspense
            fallback={
              <PageLoadingFallback
                className="task-page"
                label="正在加载任务…"
              />
            }
          >
            <TaskPage />
          </Suspense>
        }
      />
      <Route
        path="/requirements"
        element={
          <Suspense
            fallback={
              <PageLoadingFallback
                className="requirement-page"
                label="正在加载需求…"
              />
            }
          >
            <RequirementPage />
          </Suspense>
        }
      />
      <Route
        path="/defects"
        element={
          <Suspense
            fallback={
              <PageLoadingFallback
                className="defect-page"
                label="正在加载缺陷…"
              />
            }
          >
            <DefectPage />
          </Suspense>
        }
      />
      <Route
        path="/gantt"
        element={
          <Suspense
            fallback={
              <PageLoadingFallback
                className="gantt-page"
                label="正在加载甘特图…"
              />
            }
          >
            <GanttPage />
          </Suspense>
        }
      />
      {routes.map(({ heading, path }) => (
        <Route
          element={
            <section className="page-placeholder">
              <h1>{heading}</h1>
            </section>
          }
          key={path}
          path={path}
        />
      ))}
      <Route
        path="*"
        element={
          <section className="page-placeholder">
            <h1>页面未找到</h1>
            <p>这个项目页面不存在或已经移动。</p>
            <Link to="/dashboard">返回仪表盘</Link>
          </section>
        }
      />
    </Routes>
  )
}
