import type { Defect, Severity } from '../../data/domain'
import {
  defectStageForStatus,
  defectStages,
  severityLabels,
  severityOrder,
  statusLabels,
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
      <table
        aria-label="缺陷严重度与处理阶段矩阵"
        className="defect-matrix"
      >
        <thead>
          <tr>
            <th scope="col">严重度 / 处理阶段</th>
            {defectStages.map((stage) => (
              <th key={stage.id} scope="col">{stage.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {severityOrder.map((severity) => (
            <tr key={severity}>
              <th scope="row">{severityLabels[severity]}</th>
              {defectStages.map((stage) => {
                const cellDefects = defects.filter(
                  (defect) =>
                    defect.severity === severity &&
                    defectStageForStatus(defect.status) === stage.id,
                )
                return (
                  <td
                    aria-label={`${severityLabels[severity]} · ${stage.label}`}
                    key={stage.id}
                  >
                    <div className="defect-matrix__cell-stack">
                      {cellDefects.map((defect) => {
                        const selected = defect.id === selectedDefectId
                        return (
                          <button
                            aria-controls="defect-context"
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
                            <small>
                              {statusLabels[defect.status]} · {defect.assignee.name}
                            </small>
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
