import { describe, expect, it } from 'vitest'
import { parseSiteConfig } from './siteConfig'

describe('parseSiteConfig', () => {
  it('reads per-workspace assistant names', () => {
    expect(parseSiteConfig({ workspaces: { abc: { assistantName: 'Caddie' }, def: { assistantName: 3 } } }).workspaces)
      .toEqual({ abc: { assistantName: 'Caddie' } })
  })

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

  it('reads group links, build placement and workspace themes, dropping unknown values', () => {
    const config = parseSiteConfig({
      nav: {
        buildSection: true,
        buildAfterGroup: 'Operating companies',
        groups: [{ label: 'Tools', workspaceIds: ['t'], links: ['outputs', 'nope', 3] }],
      },
      workspaces: { b9: { theme: 'back9' }, bad: { theme: 'x y' } },
      home: {
        title: 'T',
        priorities: [],
        theme: 'dual',
        entities: [{ label: 'Back9 Trades', workspaceId: 'b9', theme: 'back9' }, { label: 'Hospitality' }, { nope: 1 }],
      },
    })
    expect(config.home?.theme).toBe('dual')
    expect(config.home?.entities).toEqual([
      { label: 'Back9 Trades', workspaceId: 'b9', theme: 'back9' },
      { label: 'Hospitality' },
    ])
    expect(config.nav).toEqual({
      buildSection: true,
      buildAfterGroup: 'Operating companies',
      groups: [{ label: 'Tools', workspaceIds: ['t'], links: ['outputs'] }],
    })
    expect(config.workspaces).toEqual({ b9: { theme: 'back9' } })
  })

  it('reads app-only groups and gatekeeper app titles, dropping non-https apps', () => {
    const config = parseSiteConfig({
      nav: {
        groups: [{ label: 'Applications', apps: [
          { label: 'Pursue', href: 'https://pursue.lfiq.app/' },
          { label: 'Bad', href: 'http://x.test/' },
          { label: '', href: 'https://y.test/' },
        ] }],
        appTitles: { Skills: 'Context & Skills', Bad: 3 },
      },
    })
    expect(config.nav?.groups).toEqual([
      { label: 'Applications', workspaceIds: [], apps: [{ label: 'Pursue', href: 'https://pursue.lfiq.app/' }] },
    ])
    expect(config.nav?.appTitles).toEqual({ Skills: 'Context & Skills' })
  })

  it('reads the sketch backdrop and app links on entities, dropping non-https links', () => {
    const config = parseSiteConfig({
      home: {
        title: 'T',
        priorities: [],
        backdrop: 'sketch',
        entities: [
          { label: 'Watch', href: 'https://watch.lfiq.app/', description: 'City records' },
          { label: 'Bad', href: 'javascript:alert(1)' },
        ],
      },
    })
    expect(config.home?.backdrop).toBe('sketch')
    expect(config.home?.entities).toEqual([
      { label: 'Watch', href: 'https://watch.lfiq.app/', description: 'City records' },
      { label: 'Bad' },
    ])
    expect(parseSiteConfig({ home: { title: 'T', priorities: [], backdrop: 'mesh' } }).home?.backdrop)
      .toBeUndefined()
  })
})
