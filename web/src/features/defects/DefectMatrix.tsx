import type { Defect, Severity } from '../../data/domain'
import {
  severityLabels,
  severityOrder,
  statusLabels,
  statusOrder,
} from './defect-matrix-config'

function toneForSeverity(severity: Severity) {
  if (severity === 'fatal') return 'critical'
  if (severity === 'serious') return 'warning'
  if (severity === 'normal') return 'neutral'
  return 'silver'
}

export type DefectMatrixProps = {
  defects: readonly Defect[]
  onSelect: (defectId: string) => void
  selectedDefectId: string | null
}

export function DefectMatrix({
  defects,
  onSelect,
  selectedDefectId,
}: DefectMatrixProps) {
  return (
    <div
      aria-label="缺陷矩阵横向滚动区"
      className="defect-matrix-scroll"
      role="region"
      tabIndex={0}
    >
      <table aria-label="缺陷严重度与状态矩阵" className="defect-matrix">
        <thead>
          <tr>
            <th scope="col">严重度 / 状态</th>
            {statusOrder.map((status) => (
              <th key={status} scope="col">{statusLabels[status]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {severityOrder.map((severity) => (
            <tr key={severity}>
              <th scope="row">{severityLabels[severity]}</th>
              {statusOrder.map((status) => {
                const cellDefects = defects.filter(
                  (defect) =>
                    defect.severity === severity && defect.status === status,
                )
                return (
                  <td
                    aria-label={`${severityLabels[severity]} · ${statusLabels[status]}`}
                    key={status}
                  >
                    <div className="defect-matrix__cell-stack">
                      {cellDefects.map((defect) => {
                        const selected = defect.id === selectedDefectId
                        return (
                          <button
                            aria-controls={`defect-inspector-${defect.id}`}
                            aria-expanded={selected}
                            aria-label={`查看 ${defect.title}`}
                            aria-pressed={selected}
                            className={`defect-matrix__card defect-matrix__card--${toneForSeverity(severity)}`}
                            id={`defect-trigger-${defect.id}`}
                            key={defect.id}
                            onClick={() => onSelect(defect.id)}
                            type="button"
                          >
                            <span className="defect-matrix__code">{defect.code}</span>
                            <strong>{defect.title}</strong>
                            <small>{defect.assignee.name}</small>
                          </button>
                        )
                      })}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
