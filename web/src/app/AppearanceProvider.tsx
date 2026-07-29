import {
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { useSettings, useUpdateSettings } from '../data/query-hooks'
import { ApiError } from '../data/api-client'
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
  const [startupCache] = useState(() => {
    const initial = storedAppearance() ?? defaultAppearance
    applyAppearance(initial)
    return initial
  })
  const [draft, setDraft] = useState<Appearance>(startupCache)
  const [isDirty, setIsDirty] = useState(false)
  const draftRevision = useRef(0)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const settings = useSettings()
  const update = useUpdateSettings()
  const apiBaseline = useMemo(
    () => settings.data === undefined
      ? null
      : appearanceSchema.parse({
          theme: settings.data.theme,
          background: settings.data.background,
          accent: settings.data.accent,
          density: settings.data.density,
        }),
    [settings.data],
  )
  const cachedBaseline = apiBaseline ?? startupCache
  const appearance = isDirty ? draft : cachedBaseline

  useEffect(() => {
    if (isDirty) return
    applyAppearance(cachedBaseline)
    localStorage.setItem(
      appearanceStorageKey,
      JSON.stringify(cachedBaseline),
    )
  }, [cachedBaseline, isDirty])

  function setAppearance(next: Appearance) {
    const parsed = appearanceSchema.parse(next)
    draftRevision.current += 1
    applyAppearance(parsed)
    localStorage.setItem(appearanceStorageKey, JSON.stringify(parsed))
    setDraft(parsed)
    setIsDirty(true)
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
    const submittedRevision = draftRevision.current
    try {
      const saved = await update.mutateAsync({ ...appearance, version })
      const savedAppearance = appearanceSchema.parse({
        theme: saved.theme,
        background: saved.background,
        accent: saved.accent,
        density: saved.density,
      })
      if (draftRevision.current === submittedRevision) {
        applyAppearance(savedAppearance)
        localStorage.setItem(
          appearanceStorageKey,
          JSON.stringify(savedAppearance),
        )
        setDraft(savedAppearance)
        setIsDirty(false)
        setSaveMessage('外观设置已保存。')
      }
    } catch (error) {
      if (
        error instanceof ApiError
        && (
          error.status === 409
          || error.code === 'SETTINGS_VERSION_CONFLICT'
        )
      ) {
        await settings.refetch().catch(() => undefined)
      }
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
      isDirty,
      isSaving: update.isPending,
      saveMessage,
      saveError,
    }}>
      {children}
    </AppearanceContext.Provider>
  )
}
