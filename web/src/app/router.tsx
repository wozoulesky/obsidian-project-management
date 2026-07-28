import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'

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
      <Route
        path="/defects"
        element={
          <Suspense
            fallback={
              <section className="defect-page" aria-busy="true">
                <p role="status">正在加载缺陷…</p>
              </section>
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
              <section className="gantt-page" aria-busy="true">
                <p role="status">正在加载甘特图…</p>
              </section>
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
