import {
  accentSchema,
  backgroundSchema,
  densitySchema,
  themeSchema,
} from '@project-os/contracts'
import { createContext, useContext } from 'react'
import { z } from 'zod'

export const appearanceStorageKey = 'project-os:appearance'

export const appearanceSchema = z.object({
  theme: themeSchema,
  background: backgroundSchema,
  accent: accentSchema,
  density: densitySchema,
}).strict()

export type Appearance = z.infer<typeof appearanceSchema>

export const defaultAppearance: Appearance = {
  theme: 'system',
  background: 'soft',
  accent: 'blue',
  density: 'comfortable',
}

export function storedAppearance(): Appearance | null {
  // This key is a last-applied startup cache only. Dirty state and API version
  // remain in memory, so a reload always lets the authoritative API reconcile.
  try {
    const raw = localStorage.getItem(appearanceStorageKey)
    if (raw === null) return null
    const parsed = appearanceSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  root.dataset.theme = appearance.theme
  root.dataset.background = appearance.background
  root.dataset.accent = appearance.accent
  root.dataset.density = appearance.density
}

export type AppearanceContextValue = {
  appearance: Appearance
  setAppearance: (next: Appearance) => void
  save: () => Promise<void>
  isSaving: boolean
  saveMessage: string
  saveError: string
}

export const AppearanceContext =
  createContext<AppearanceContextValue | null>(null)

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (context === null) {
    throw new Error('useAppearance must be used within AppearanceProvider')
  }
  return context
}
