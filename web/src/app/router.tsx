import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

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

const routes = [
  { path: '/gantt', heading: '甘特图' },
  { path: '/defects', heading: '缺陷' },
  { path: '/settings', heading: '设置' },
] as const

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />
      <Route
        path="/dashboard"
        element={
          <Suspense
            fallback={
              <section className="dashboard-page" aria-busy="true">
                <p role="status">正在加载仪表盘…</p>
              </section>
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
              <section className="task-page" aria-busy="true">
                <p role="status">正在加载任务…</p>
              </section>
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
              <section className="requirement-page" aria-busy="true">
                <p role="status">正在加载需求…</p>
              </section>
            }
          >
            <RequirementPage />
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
    </Routes>
  )
}
