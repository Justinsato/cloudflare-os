import { describe, expect, it } from 'vitest'
import { formatUsageCost } from './formatUsageCost'

describe('formatUsageCost', () => {
  it('rounds to cents', () => {
    expect(formatUsageCost(0.8744)).toBe('$0.87')
    expect(formatUsageCost(20.0544)).toBe('$20.05')
    expect(formatUsageCost(1290.5)).toBe('$1,290.50')
  })

  it('handles zero and sub-cent amounts', () => {
    expect(formatUsageCost(0)).toBe('$0')
    expect(formatUsageCost(0.004)).toBe('<$0.01')
  })
})
