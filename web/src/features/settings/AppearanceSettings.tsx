import type {
  Accent,
  Background,
  Density,
  Theme,
} from '../../data/domain'
import {
  useAppearance,
  type Appearance,
} from '../../app/appearance-context'

const choices: {
  key: keyof Appearance
  legend: string
  values: readonly { value: string; label: string }[]
}[] = [
  {
    key: 'theme',
    legend: '主题',
    values: [
      { value: 'light', label: '浅色' },
      { value: 'dark', label: '深色' },
      { value: 'system', label: '跟随系统' },
    ] satisfies readonly { value: Theme; label: string }[],
  },
  {
    key: 'background',
    legend: '背景',
    values: [
      { value: 'solid', label: '纯色' },
      { value: 'soft', label: '柔和' },
      { value: 'gradient', label: '渐变' },
    ] satisfies readonly { value: Background; label: string }[],
  },
  {
    key: 'accent',
    legend: '强调色',
    values: [
      { value: 'blue', label: '蓝色' },
      { value: 'teal', label: '青色' },
      { value: 'purple', label: '紫色' },
      { value: 'orange', label: '橙色' },
    ] satisfies readonly { value: Accent; label: string }[],
  },
  {
    key: 'density',
    legend: '界面密度',
    values: [
      { value: 'comfortable', label: '舒适' },
      { value: 'compact', label: '紧凑' },
    ] satisfies readonly { value: Density; label: string }[],
  },
]

export function AppearanceSettings() {
  const {
    appearance,
    setAppearance,
    save,
    isSaving,
    saveMessage,
    saveError,
  } = useAppearance()

  return (
    <section
      aria-labelledby="appearance-settings-title"
      className="settings-card settings-card--wide"
    >
      <header>
        <h2 id="appearance-settings-title">外观</h2>
        <p>选择预设后立即预览；点击保存才会同步到服务端。</p>
      </header>
      <div className="appearance-options">
        {choices.map((choice) => (
          <fieldset key={choice.key}>
            <legend>{choice.legend}</legend>
            <div className="appearance-options__group">
              {choice.values.map(({ value, label }) => (
                <label key={value}>
                  <input
                    checked={appearance[choice.key] === value}
                    name={`appearance-${choice.key}`}
                    onChange={() => setAppearance({
                      ...appearance,
                      [choice.key]: value,
                    } as Appearance)}
                    type="radio"
                    value={value}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="settings-actions">
        <button
          className="button button--primary"
          disabled={isSaving}
          onClick={() => void save()}
          type="button"
        >
          {isSaving ? '正在保存…' : '保存外观设置'}
        </button>
        {saveMessage && <p role="status">{saveMessage}</p>}
        {saveError && <p role="alert">{saveError}</p>}
      </div>
    </section>
  )
}
