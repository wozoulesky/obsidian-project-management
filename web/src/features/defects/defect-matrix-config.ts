import type { DefectStatus, Severity } from '../../data/domain'

export const severityOrder = [
  'fatal',
  'serious',
  'normal',
  'suggestion',
] as const satisfies readonly Severity[]

export const statusOrder = [
  'open',
  'fixing',
  'verifying',
  'closed',
  'rejected',
  'not_a_defect',
] as const satisfies readonly DefectStatus[]

export const severityLabels: Record<Severity, string> = {
  fatal: '致命',
  serious: '严重',
  normal: '一般',
  suggestion: '建议',
}

export const statusLabels: Record<DefectStatus, string> = {
  open: '待处理',
  fixing: '修复中',
  verifying: '验证中',
  closed: '已关闭',
  rejected: '已驳回',
  not_a_defect: '非缺陷',
}
