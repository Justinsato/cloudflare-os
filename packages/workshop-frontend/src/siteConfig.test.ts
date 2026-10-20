import { describe, expect, it } from 'vitest'
import { parseSiteConfig } from './siteConfig'

describe('parseSiteConfig', () => {
  it('returns nothing for a missing or malformed config', () => {
    expect(parseSiteConfig(undefined)).toEqual({})
    expect(parseSiteConfig('x')).toEqual({})
    expect(parseSiteConfig({ home: { subtitle: 'no title' } }).home).toBeUndefined()
  })

  it('keeps valid priorities and drops incomplete ones', () => {
    const config = parseSiteConfig({
      home: {
        title: 'Where should capital go next?',
        priorities: [
          { label: 'Refinance', description: 'Debt book', workspaceId: 'abc', workpieceId: 28, icon: 'bank' },
          { label: 'No workspace', description: 'Dropped' },
        ],
      },
    })
    expect(config.home?.priorities).toEqual([
      { label: 'Refinance', description: 'Debt book', workspaceId: 'abc', workpieceId: 28, icon: 'bank' },
    ])
  })

  it('reads nav groups and the build section flag', () => {
    const config = parseSiteConfig({
      nav: {
        buildSection: true,
        groups: [
          { label: 'Portfolio', workspaceIds: ['a', 'b', 7] },
          { label: 'Missing ids' },
        ],
      },
    })
    expect(config.nav).toEqual({ buildSection: true, groups: [{ label: 'Portfolio', workspaceIds: ['a', 'b'] }] })
  })
})
