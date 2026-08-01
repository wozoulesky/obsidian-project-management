import type { ReactNode } from 'react'

export type PageHeaderProps = {
  actions?: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
}

export function PageHeader({
  actions,
  eyebrow,
  subtitle,
  title,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__content">
        {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="page-header__title">{title}</h1>
        {subtitle ? (
          <p className="page-header__subtitle">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}
