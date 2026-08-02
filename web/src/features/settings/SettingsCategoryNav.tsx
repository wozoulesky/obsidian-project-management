import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  settingsCategories,
  type SettingsCategoryId,
} from './settings-categories'

export type SettingsCategoryNavProps = {
  activeCategory: SettingsCategoryId
  onChange: (category: SettingsCategoryId) => void
}

const mobileSettingsQuery = '(max-width: 48rem)'

function useSettingsNavOrientation() {
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>(
    'vertical',
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const query = window.matchMedia(mobileSettingsQuery)
    const updateOrientation = (matches: boolean) => {
      setOrientation(matches ? 'horizontal' : 'vertical')
    }
    const handleChange = (event: MediaQueryListEvent) => {
      updateOrientation(event.matches)
    }

    updateOrientation(query.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return orientation
}

export function SettingsCategoryNav({
  activeCategory,
  onChange,
}: SettingsCategoryNavProps) {
  const orientation = useSettingsNavOrientation()
  const buttonRefs = useRef<Partial<
    Record<SettingsCategoryId, HTMLButtonElement | null>
  >>({})

  const move = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: SettingsCategoryId,
  ) => {
    const currentIndex = settingsCategories.findIndex(
      (category) => category.id === current,
    )
    let nextIndex: number | null = null
    const forwardKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
    const backwardKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
    if (event.key === forwardKey) {
      nextIndex = (currentIndex + 1) % settingsCategories.length
    } else if (event.key === backwardKey) {
      nextIndex = (
        currentIndex - 1 + settingsCategories.length
      ) % settingsCategories.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = settingsCategories.length - 1
    }
    if (nextIndex === null) return

    event.preventDefault()
    const nextCategory = settingsCategories[nextIndex]!
    onChange(nextCategory.id)
    buttonRefs.current[nextCategory.id]?.focus()
  }

  return (
    <nav
      aria-label="设置分类"
      aria-orientation={orientation}
      className="settings-category-nav"
      role="tablist"
    >
      {settingsCategories.map((category) => (
        <button
          aria-controls={`settings-panel-${category.id}`}
          aria-selected={activeCategory === category.id}
          className="settings-category-nav__item"
          id={`settings-tab-${category.id}`}
          key={category.id}
          onClick={() => onChange(category.id)}
          onKeyDown={(event) => move(event, category.id)}
          ref={(node) => {
            buttonRefs.current[category.id] = node
          }}
          role="tab"
          tabIndex={activeCategory === category.id ? 0 : -1}
          type="button"
        >
          <strong>{category.label}</strong>
        </button>
      ))}
    </nav>
  )
}
