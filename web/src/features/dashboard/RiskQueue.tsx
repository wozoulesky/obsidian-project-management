import type { RiskItem } from '../../data/domain'
import { Badge } from '../../components/ui/Badge'
import { Progress } from '../../components/ui/Progress'

export function RiskQueue({
  risks,
  onSelect,
}: {
  risks: RiskItem[]
  onSelect: (risk: RiskItem) => void
}) {
  return (
    <div className="data-grid risk-queue">
      <table aria-label="风险队列">
        <thead>
          <tr>
            <th scope="col">事项</th>
            <th scope="col">负责人</th>
            <th scope="col">进度</th>
            <th scope="col">截止</th>
            <th scope="col">风险</th>
          </tr>
        </thead>
        <tbody>
          {risks.map((risk) => (
            <tr
              className="risk-queue__row"
              key={risk.id}
              onClick={() => onSelect(risk)}
            >
              <td>
                <button
                  aria-label={`查看风险：${risk.title}`}
                  className="risk-queue__select"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(risk)
                  }}
                  type="button"
                >
                  {risk.title}
                </button>
              </td>
              <td>{risk.assignee.name}</td>
              <td>
                <div className="risk-queue__progress">
                  <Progress
                    label={`${risk.title} 进度 ${risk.progress}%`}
                    value={risk.progress}
                  />
                  <span className="tabular-numerals">{risk.progress}%</span>
                </div>
              </td>
              <td className="tabular-numerals">{risk.dueDate}</td>
              <td>
                <Badge tone={risk.level}>
                  {risk.level === 'critical' ? '严重' : '预警'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
