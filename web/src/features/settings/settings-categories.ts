export type SettingsCategoryId = 'appearance' | 'data' | 'mcp' | 'skills'

export const settingsCategories = [
  { id: 'appearance', label: '外观' },
  { id: 'data', label: '数据' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
] as const satisfies ReadonlyArray<{
  id: SettingsCategoryId
  label: string
}>
