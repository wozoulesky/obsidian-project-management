export type SettingsCategoryId = 'appearance' | 'data' | 'mcp' | 'skills'

export const settingsCategories = [
  {
    id: 'appearance',
    label: '外观',
    description: '调整主题、背景、强调色与界面密度。',
    meta: '本页内即时预览 · 显式保存',
  },
  {
    id: 'data',
    label: '数据',
    description: '管理本机数据库备份与安全的 JSON 迁移。',
    meta: '本机数据 · 操作后反馈',
  },
  {
    id: 'mcp',
    label: 'MCP',
    description: '查看本机端点，并签发或撤销访问令牌。',
    meta: '令牌明文仅显示一次',
  },
  {
    id: 'skills',
    label: 'Skills',
    description: '获取客户端连接配置与可安装的 Agent Skill。',
    meta: '服务端配置 · 本页内复制',
  },
] as const satisfies ReadonlyArray<{
  id: SettingsCategoryId
  label: string
  description: string
  meta: string
}>
