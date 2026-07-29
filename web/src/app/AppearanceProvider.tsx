import {
  useEffect,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { useSettings, useUpdateSettings } from '../data/query-hooks'
import {
  AppearanceContext,
  appearanceSchema,
  appearanceStorageKey,
  applyAppearance,
  defaultAppearance,
  storedAppearance,
  type Appearance,
} from './appearance-context'

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const parent = useContext(AppearanceContext)
  if (parent !== null) return children
  return <AppearanceProviderRoot>{children}</AppearanceProviderRoot>
}

function AppearanceProviderRoot({ children }: { children: ReactNode }) {
  const [initialStored] = useState(storedAppearance)
  const [previewAppearance, setPreviewAppearance] =
    useState<Appearance | null>(() => {
    const initial = initialStored ?? defaultAppearance
    applyAppearance(initial)
    return initialStored === null ? null : initial
  })
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const settings = useSettings()
  const update = useUpdateSettings()
  const reconciled = useRef(false)
  const remoteAppearance = settings.data === undefined
    ? defaultAppearance
    : appearanceSchema.parse({
        theme: settings.data.theme,
        background: settings.data.background,
        accent: settings.data.accent,
        density: settings.data.density,
      })
  const appearance = previewAppearance ?? remoteAppearance

  useEffect(() => {
    if (
      reconciled.current
      || settings.data === undefined
      || previewAppearance !== null
    ) return
    reconciled.current = true
    if (initialStored !== null) return
    applyAppearance(remoteAppearance)
    localStorage.setItem(
      appearanceStorageKey,
      JSON.stringify(remoteAppearance),
    )
  }, [
    initialStored,
    previewAppearance,
    remoteAppearance,
    settings.data,
  ])

  function setAppearance(next: Appearance) {
    const parsed = appearanceSchema.parse(next)
    applyAppearance(parsed)
    localStorage.setItem(appearanceStorageKey, JSON.stringify(parsed))
    setPreviewAppearance(parsed)
    setSaveMessage('')
    setSaveError('')
  }

  async function save() {
    setSaveMessage('')
    setSaveError('')
    const version = settings.data?.version
    if (version === undefined) {
      setSaveError('无法读取当前设置版本，请稍后重试。')
      return
    }
    try {
      await update.mutateAsync({ ...appearance, version })
      setSaveMessage('外观设置已保存。')
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? `保存失败：${error.message}`
          : '保存失败，请重试。',
      )
    }
  }

  return (
    <AppearanceContext.Provider value={{
      appearance,
      setAppearance,
      save,
      isSaving: update.isPending,
      saveMessage,
      saveError,
    }}>
      {children}
    </AppearanceContext.Provider>
  )
}
