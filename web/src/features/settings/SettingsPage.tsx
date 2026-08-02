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
        {settingsCategories.map((category) => {
          const active = category.id === activeCategory
          return (
            <GlassPanel
              ariaLabel={`${category.label}设置`}
              aria-labelledby={`settings-tab-${category.id}`}
              className={`settings-page__panel${
                active ? ' settings-page__panel--active' : ''
              }`}
              hidden={!active}
              id={`settings-panel-${category.id}`}
              key={category.id}
              role="tabpanel"
              tabIndex={active ? 0 : -1}
            >
              <header className="settings-panel-heading">
                <div>
                  <h2 id={`settings-panel-heading-${category.id}`}>
                    {category.label}
                  </h2>
                  <p>{category.description}</p>
                </div>
                <span className="settings-panel-heading__meta">
                  {category.meta}
                </span>
              </header>
              <SettingsCategoryContent category={category.id} />
            </GlassPanel>
          )
        })}
      </div>
    </section>
  )
}
