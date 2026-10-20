import { Desktop, Moon, Sun } from '@phosphor-icons/react'
import { Tooltip } from '@cloudflare/kumo'
import { useTheme } from '../ThemeContext'
import type { ThemeMode } from '../theme'

// One switch for the app and every gadget frame in it: GadgetUI hands the resolved mode to each
// sandboxed frame, so a gadget never needs a theme control of its own.
const THEME_SEQUENCE: ThemeMode[] = ['light', 'dark', 'system']

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(mode) + 1) % THEME_SEQUENCE.length]
}

export default function ThemeModeButton({ className = '' }: { className?: string }) {
  const { themeMode, resolvedThemeMode, setThemeMode } = useTheme()
  const label = themeMode === 'system'
    ? `Theme: system (${resolvedThemeMode})`
    : `Theme: ${themeMode}`
  const nextMode = nextThemeMode(themeMode)
  const description = `${label}. Switch to ${nextMode}.`

  return (
    <Tooltip
      content={description}
      render={(
        <button
          type="button"
          aria-label={description}
          data-theme-mode={themeMode}
          onClick={() => setThemeMode(nextMode)}
          className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-elevated ${className}`}
        >
          {themeMode === 'system' ? (
            <Desktop size={15} />
          ) : themeMode === 'dark' ? (
            <Moon size={15} />
          ) : (
            <Sun size={15} />
          )}
        </button>
      )}
    />
  )
}
