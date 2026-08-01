export function GeneralSettings() {
  return (
    <section aria-labelledby="general-settings-title" className="settings-card">
      <header>
        <h2 id="general-settings-title">常规</h2>
        <p>当前工作区通过本机服务运行，设置会同步到 SQLite。</p>
      </header>
      <dl className="settings-facts">
        <div><dt>运行模式</dt><dd>本地优先</dd></div>
        <div><dt>保存策略</dt><dd>显式保存并校验版本</dd></div>
      </dl>
    </section>
  )
}
