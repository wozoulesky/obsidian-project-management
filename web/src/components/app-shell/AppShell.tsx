import {
  Bug,
  ChartNoAxesGantt,
  Check,
  FolderKanban,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { NavLink } from 'react-router-dom'

import { QuickSubmitDialog } from '../../features/tasks/QuickSubmitDialog'
import { Badge } from '../ui/Badge'
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
  const [isRailExpanded, setIsRailExpanded] = useState(false)
  const [isQuickSubmitOpen, setIsQuickSubmitOpen] = useState(false)
  const [quickSubmitAnnouncement, setQuickSubmitAnnouncement] = useState('')
  const toggleLabel = isRailExpanded ? '收起侧边栏' : '展开侧边栏'
  const closeQuickSubmit = () => {
    setIsQuickSubmitOpen(false)
    queueMicrotask(() => {
      document.getElementById('quick-submit-trigger')?.focus()
    })
  }

  return (
    <div
      className={`app-shell${isRailExpanded ? ' app-shell--rail-expanded' : ''}`}
    >
      <a
        aria-hidden={isQuickSubmitOpen || undefined}
        className="skip-link"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <aside
        aria-hidden={isQuickSubmitOpen || undefined}
        className={`app-rail${isRailExpanded ? ' app-rail--expanded' : ''}`}
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
            <small className="app-rail__brand-meta">TASK CONSOLE</small>
          </span>
        </NavLink>
        <button
          aria-expanded={isRailExpanded}
          aria-label={toggleLabel}
          className="app-rail__toggle"
          onClick={() => setIsRailExpanded((isExpanded) => !isExpanded)}
          title={toggleLabel}
          type="button"
        >
          {isRailExpanded ? (
            <PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.8} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={1.8} />
          )}
        </button>
        <nav aria-label="主导航" className="app-rail__nav">
          {navigationGroups.map((group) => (
            <div
              aria-label={group.label}
              className={`app-rail__group app-rail__group--${group.id}`}
              key={group.id}
              role="group"
            >
              {isRailExpanded ? (
                <span aria-hidden="true" className="app-rail__group-label">
                  {group.label}
                </span>
              ) : null}
              {navigationItems
                .filter((item) => item.group === group.id)
                .map(({ icon: Icon, label, path }) => (
                  <NavLink
                    aria-label={isQuickSubmitOpen ? undefined : label}
                    className={({ isActive }) =>
                      `app-rail__link${isActive ? ' app-rail__link--active' : ''}`
                    }
                    key={path}
                    title={isRailExpanded ? undefined : label}
                    to={path}
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    {isRailExpanded ? (
                      <span className="app-rail__label">{label}</span>
                    ) : null}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      </aside>

      <header
        aria-hidden={isQuickSubmitOpen || undefined}
        className="app-header"
      >
        <div className="app-header__project">
          <Badge tone="primary">OFFLINE / LOCAL</Badge>
          <span className="app-header__project-name">Atlas 研发平台</span>
        </div>
        <div className="app-header__actions">
          <div
            className="app-header__save-status"
            role={quickSubmitAnnouncement ? 'status' : undefined}
          >
            <span className="app-header__save-message">
              <Check aria-hidden="true" size={15} />
              {quickSubmitAnnouncement || '数据已保存到本地'}
            </span>
            <span className="app-header__updated">最后更新 10:42</span>
          </div>
          <Button
            id="quick-submit-trigger"
            onClick={() => {
              setQuickSubmitAnnouncement('')
              setIsQuickSubmitOpen(true)
            }}
            variant="primary"
          >
            <Plus aria-hidden="true" size={17} />
            快速提交
          </Button>
        </div>
      </header>

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
