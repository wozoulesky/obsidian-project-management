import { AlertTriangle } from 'lucide-react'

import type { RiskItem } from '../../data/domain'
import { Badge } from '../../components/ui/Badge'

export function RiskBanner({ risks }: { risks: RiskItem[] }) {
  if (risks.length === 0) {
    return (
      <section className="risk-banner risk-banner--clear" aria-label="项目风险">
        <span>当前无逾期或临期事项</span>
      </section>
    )
  }

  const highestRisk =
    risks.find((risk) => risk.level === 'critical') ?? risks[0]

  return (
    <section className="risk-banner" aria-label="项目风险">
      <AlertTriangle aria-hidden="true" size={18} />
      <div>
        <strong>需要关注：{highestRisk.title}</strong>
        <span>
          {highestRisk.assignee.name} · 截止 {highestRisk.dueDate}
        </span>
      </div>
      <Badge tone={highestRisk.level}>
        {highestRisk.level === 'critical' ? '严重风险' : '风险'}
      </Badge>
    </section>
  )
}
