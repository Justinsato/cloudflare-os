// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ACCENT_COLOR, defaultAccentColor } from './theme'

describe('defaultAccentColor', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--default-accent-color')
  })

  it('falls back to the upstream default', () => {
    expect(defaultAccentColor()).toBe(DEFAULT_ACCENT_COLOR)
  })

  it('reads the deployment theme declaration', () => {
    document.documentElement.style.setProperty('--default-accent-color', '#173454')
    expect(defaultAccentColor()).toBe('#173454')
  })
})
