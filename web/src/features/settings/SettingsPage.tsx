import { AppearanceSettings } from './AppearanceSettings'
import { DataSettings } from './DataSettings'
import { McpSettings } from './McpSettings'
import { SkillSettings } from './SkillSettings'

export function SettingsPage() {
  return (
    <section aria-labelledby="settings-page-title" className="settings-page">
      <header className="settings-page__header">
        <div>
          <p className="route-shell__eyebrow">SETTINGS</p>
          <h1 id="settings-page-title">设置</h1>
        </div>
        <p>管理本机外观、数据安全和 Agent 连接。所有敏感令牌只显示一次。</p>
      </header>

      <div className="settings-page__grid">
        <AppearanceSettings />
        <section
          aria-labelledby="general-settings-title"
          className="settings-card"
        >
          <header>
            <h2 id="general-settings-title">常规</h2>
            <p>当前工作区通过本机服务运行，设置会同步到 SQLite。</p>
          </header>
          <dl className="settings-facts">
            <div><dt>运行模式</dt><dd>本地优先</dd></div>
            <div><dt>保存策略</dt><dd>显式保存并校验版本</dd></div>
          </dl>
        </section>
        <DataSettings />
        <McpSettings />
        <SkillSettings />
      </div>
    </section>
  )
}
