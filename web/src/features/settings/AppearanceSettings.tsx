import type {
  Accent,
  Background,
  Density,
  Theme,
} from '../../data/domain'
import { useEffect, useRef } from 'react'
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
  const saveErrorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (saveError) saveErrorRef.current?.focus()
  }, [saveError])

  return (
    <section
      aria-label="显示偏好"
      className="settings-card settings-card--wide"
    >
      <div className="appearance-options settings-control-grid">
        {choices.map((choice) => (
          <fieldset className="settings-control-row" key={choice.key}>
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
        {saveError && (
          <p ref={saveErrorRef} role="alert" tabIndex={-1}>
            {saveError}
          </p>
        )}
      </div>
    </section>
  )
}
