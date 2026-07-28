import { Navigate, Route, Routes } from 'react-router-dom'

import { DashboardPage } from '../features/dashboard/DashboardPage'

const routes = [
  { path: '/tasks', heading: '计划 / 任务' },
  { path: '/gantt', heading: '甘特图' },
  { path: '/requirements', heading: '需求' },
  { path: '/defects', heading: '缺陷' },
  { path: '/settings', heading: '设置' },
] as const

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />
      <Route path="/dashboard" element={<DashboardPage />} />
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
