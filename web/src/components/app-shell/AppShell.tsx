import {
  Bug,
  ChartNoAxesGantt,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { NavLink } from 'react-router-dom'

import {
  useCurrentActor,
  useProjectRepository,
  useProjects,
} from '../../data/query-hooks'
import { QuickSubmitDialog } from '../../features/tasks/QuickSubmitDialog'
import { Button } from '../ui/Button'

type AppShellProps = {
  children?: ReactNode
}

const navigationItems = [
  {
    group: 'overview',
    label: '仪表盘',
    path: '/dashboard',
    icon: LayoutDashboard,
  },
  { group: 'overview', label: '项目', path: '/projects', icon: FolderKanban },
  { group: 'overview', label: '负责人', path: '/actors', icon: Users },
  { group: 'delivery', label: '项目详情', path: null, icon: FolderOpen },
  { group: 'delivery', label: '计划 / 任务', path: '/tasks', icon: ListTodo },
  { group: 'delivery', label: '甘特图', path: '/gantt', icon: ChartNoAxesGantt },
  { group: 'quality', label: '需求', path: '/requirements', icon: Lightbulb },
  { group: 'quality', label: '缺陷', path: '/defects', icon: Bug },
  { group: 'system', label: '设置', path: '/settings', icon: Settings },
] as const

const navigationGroups = [
  { id: 'overview', label: '概览' },
  { id: 'delivery', label: '交付' },
  { id: 'quality', label: '质量' },
  { id: 'system', label: '系统' },
] as const

export function AppShell({ children }: AppShellProps) {
  const projects = useProjects()
  const currentActor = useCurrentActor()
  const { projectId, selectProject } = useProjectRepository()
  const [isQuickSubmitOpen, setIsQuickSubmitOpen] = useState(false)
  const [quickSubmitAnnouncement, setQuickSubmitAnnouncement] = useState('')
  const currentProject = projects.data?.find(({ id }) => id === projectId)
  const currentActorName = currentActor.data?.name
    ?? (currentActor.isError ? '负责人不可用' : '正在读取…')
  const currentActorInitials = currentActor.data?.name
    .trim()
    .slice(0, 2)
    .toUpperCase() || '…'
  const closeQuickSubmit = () => {
    setIsQuickSubmitOpen(false)
    queueMicrotask(() => {
      document.getElementById('quick-submit-trigger')?.focus()
    })
  }

  return (
    <div className="app-shell">
      <a
        aria-hidden={isQuickSubmitOpen || undefined}
        className="skip-link"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <aside
        aria-hidden={isQuickSubmitOpen || undefined}
        className="app-rail"
      >
        <NavLink
          aria-label="Project OS"
          className="app-rail__brand"
          title="Project OS"
          to="/dashboard"
        >
          <span aria-hidden="true" className="app-rail__brand-mark">OS</span>
          <span className="app-rail__brand-copy">
            <strong className="app-rail__brand-name">Project OS</strong>
            <small className="app-rail__brand-meta">DELIVERY SYSTEM</small>
          </span>
        </NavLink>
        <nav aria-label="主导航" className="app-rail__nav">
          {navigationGroups.map((group) => (
            <div
              aria-label={group.label}
              className={`app-rail__group app-rail__group--${group.id}`}
              key={group.id}
              role="group"
            >
              <span className="app-rail__group-label">
                {group.label}
              </span>
              {navigationItems
                .filter((item) => item.group === group.id)
                .map(({ icon: Icon, label, path }) => (
                  <NavLink
                    aria-label={isQuickSubmitOpen ? undefined : label}
                    className={({ isActive }) =>
                      `app-rail__link${isActive ? ' app-rail__link--active' : ''}`
                    }
                    end={path === '/projects'}
                    key={label}
                    to={path ?? `/projects/${projectId}`}
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    <span className="app-rail__label">{label}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="app-rail__footer">
          <section
            aria-labelledby="current-workspace-title"
            className="app-rail__footer-card app-rail__workspace-card"
          >
            <div className="app-rail__card-copy">
              <label
                className="app-rail__card-label"
                htmlFor="workspace-project-select"
                id="current-workspace-title"
              >
                当前工作区
              </label>
              <select
                aria-label="选择当前工作区"
                className="app-rail__project-select"
                id="workspace-project-select"
                onChange={(event) => selectProject(event.target.value)}
                value={projectId}
              >
                {currentProject === undefined ? (
                  <option value={projectId}>{projectId}</option>
                ) : null}
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              aria-label="快速提交"
              className="app-rail__quick-submit"
              id="quick-submit-trigger"
              onClick={() => {
                setQuickSubmitAnnouncement('')
                setIsQuickSubmitOpen(true)
              }}
              variant="primary"
            >
              <Plus aria-hidden="true" size={17} />
              <span>快速提交</span>
            </Button>
            {quickSubmitAnnouncement ? (
              <span className="app-rail__announcement" role="status">
                {quickSubmitAnnouncement}
              </span>
            ) : null}
          </section>
          <section
            aria-labelledby="current-owner-title"
            className="app-rail__footer-card app-rail__owner-card"
          >
            <span aria-hidden="true" className="app-rail__owner-avatar">
              {currentActorInitials}
            </span>
            <span className="app-rail__card-copy">
              <span className="app-rail__card-label" id="current-owner-title">
                当前负责人
              </span>
              <strong className="app-rail__card-value">{currentActorName}</strong>
            </span>
          </section>
        </div>
      </aside>

      <main
        aria-hidden={isQuickSubmitOpen || undefined}
        className="app-main"
        id="main-content"
        tabIndex={-1}
      >
        {children}
      </main>
      {isQuickSubmitOpen ? (
        <QuickSubmitDialog
          onClose={closeQuickSubmit}
          onSuccess={(progress) => {
            setQuickSubmitAnnouncement(`已更新至 ${progress}%`)
            closeQuickSubmit()
          }}
        />
      ) : null}
    </div>
  )
}
