import { useState } from 'react'

import { PageHeader } from '../../components/layout/PageHeader'
import { GlassPanel } from '../../components/ui/GlassPanel'
import { AppearanceSettings } from './AppearanceSettings'
import { DataSettings } from './DataSettings'
import { GeneralSettings } from './GeneralSettings'
import { McpSettings } from './McpSettings'
import {
  SettingsCategoryNav,
} from './SettingsCategoryNav'
import {
  settingsCategories,
  type SettingsCategoryId,
} from './settings-categories'
import { SkillSettings } from './SkillSettings'
import './settings-glass.css'

function SettingsCategoryContent({ category }: {
  category: SettingsCategoryId
}) {
  if (category === 'appearance') return <AppearanceSettings />
  if (category === 'data') {
    return (
      <div className="settings-category-stack">
        <GeneralSettings />
        <DataSettings />
      </div>
    )
  }
  if (category === 'mcp') return <McpSettings />
  return <SkillSettings />
}

export function SettingsPage() {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(
    'appearance',
  )
  const activeLabel = settingsCategories.find(
    (category) => category.id === activeCategory,
  )?.label ?? '外观'

  return (
    <section aria-labelledby="settings-page-title" className="settings-page">
      <PageHeader
        eyebrow="SETTINGS"
        subtitle="管理本机外观、数据安全和 Agent 连接。所有敏感令牌只显示一次。"
        title={<span id="settings-page-title">设置中心</span>}
      />

      <div className="settings-page__workspace">
        <SettingsCategoryNav
          activeCategory={activeCategory}
          onChange={setActiveCategory}
        />
        <GlassPanel
          ariaLabel={`${activeLabel}设置`}
          aria-labelledby={`settings-tab-${activeCategory}`}
          className="settings-page__panel"
          id={`settings-panel-${activeCategory}`}
          role="tabpanel"
          tabIndex={0}
        >
          <SettingsCategoryContent category={activeCategory} />
        </GlassPanel>
      </div>
    </section>
  )
}
