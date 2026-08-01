import { useEffect, useMemo, useState } from 'react'

export type AppearanceTokenDefinition = {
  fallback: string
  property: `--${string}`
}

type ResolvedAppearanceTokens<
  Definitions extends Record<string, AppearanceTokenDefinition>,
> = {
  [Key in keyof Definitions]: string
}

export function useAppearanceRevision(): number {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const root = document.documentElement
    const refresh = () => setRevision((currentRevision) => currentRevision + 1)
    const observer = new MutationObserver(refresh)
    observer.observe(root, {
      attributeFilter: ['data-accent', 'data-theme'],
      attributes: true,
    })

    const colorScheme = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
    colorScheme?.addEventListener('change', refresh)

    return () => {
      observer.disconnect()
      colorScheme?.removeEventListener('change', refresh)
    }
  }, [])

  return revision
}

function resolveAppearanceToken({
  fallback,
  property,
}: AppearanceTokenDefinition): string {
  if (
    typeof document === 'undefined'
    || typeof getComputedStyle === 'undefined'
  ) {
    return fallback
  }

  return getComputedStyle(document.documentElement)
    .getPropertyValue(property)
    .trim() || fallback
}

export function useAppearanceTokens<
  const Definitions extends Record<string, AppearanceTokenDefinition>,
>(
  definitions: Definitions,
): ResolvedAppearanceTokens<Definitions> {
  const revision = useAppearanceRevision()

  return useMemo(() => {
    void revision
    const resolved: Record<string, string> = {}
    for (const [name, definition] of Object.entries(definitions)) {
      resolved[name] = resolveAppearanceToken(definition)
    }
    return resolved as ResolvedAppearanceTokens<Definitions>
  }, [definitions, revision])
}
