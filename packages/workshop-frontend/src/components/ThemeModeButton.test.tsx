// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

// Kumo's Tooltip needs a provider and portals; render the trigger alone.
vi.mock('@cloudflare/kumo', () => ({
  Tooltip: ({ render }: { render: ReactNode }) => render,
}))

// jsdom has no matchMedia. The OS preference here is dark, so "system" resolves to dark.
window.matchMedia = ((query: string) => ({
  matches: query === '(prefers-color-scheme: dark)',
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as typeof window.matchMedia

import ThemeModeButton, { nextThemeMode } from './ThemeModeButton'
import { ThemeProvider } from '../ThemeContext'

const STORAGE_KEY = 'gadgets:theme-mode'

describe('ThemeModeButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.style.colorScheme = ''
  })

  const button = () => container.querySelector('button')!
  const render = async () => act(async () => root.render(<ThemeProvider><ThemeModeButton /></ThemeProvider>))

  it('cycles light, dark, system', () => {
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
  })

  it('names the current mode, cycles on click, and persists through theme storage', async () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    await render()
    expect(button().getAttribute('aria-label')).toBe('Theme: light. Switch to dark.')
    expect(document.documentElement.getAttribute('data-mode')).toBe('light')

    await act(async () => button().click())
    expect(button().getAttribute('aria-label')).toBe('Theme: dark. Switch to system.')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark')

    await act(async () => button().click())
    expect(button().getAttribute('aria-label')).toBe('Theme: system (dark). Switch to light.')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system')

    await act(async () => button().click())
    expect(button().getAttribute('aria-label')).toBe('Theme: light. Switch to dark.')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-mode')).toBe('light')
  })

  it('reads the stored mode on a fresh mount', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    await render()
    expect(button().getAttribute('aria-label')).toBe('Theme: dark. Switch to system.')
  })

  it('keeps two controls on one state', async () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    await act(async () => root.render(
      <ThemeProvider><ThemeModeButton /><ThemeModeButton /></ThemeProvider>,
    ))
    const [first, second] = container.querySelectorAll('button')
    await act(async () => first.click())
    expect(second.getAttribute('aria-label')).toBe('Theme: dark. Switch to system.')
  })
})
