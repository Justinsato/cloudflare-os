import { describe, expect, it } from 'vitest'
import { workspaceMonogram } from './workspaceMonogram'

describe('workspaceMonogram', () => {
  it('skips connecting words', () => {
    expect(workspaceMonogram('Library and Lists')).toBe('LL')
    expect(workspaceMonogram('Admin and Settings')).toBe('AS')
  })

  it('takes the first two words', () => {
    expect(workspaceMonogram('Portfolio Management')).toBe('PM')
    expect(workspaceMonogram('Back9 Trades')).toBe('BT')
    expect(workspaceMonogram('Mofo Tools')).toBe('MT')
  })

  it('handles one word and empty titles', () => {
    expect(workspaceMonogram('Workshop')).toBe('W')
    expect(workspaceMonogram('')).toBe('U')
    expect(workspaceMonogram(undefined)).toBe('U')
  })
})
