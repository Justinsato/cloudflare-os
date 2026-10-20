import { describe, expect, it } from 'vitest'
import type { WorkpieceSummary } from '@gadgets/workshop-shared/api'
import {
  gadgetTitleDetail, groupWorkpieces, matchesWorkpieceQuery, parseGadgetTitle,
} from './gadgetTitle'

describe('parseGadgetTitle', () => {
  it('splits a convention title into its four parts', () => {
    expect(parseGadgetTitle('Dashboard · Monitor · Debt Maturities · Daily')).toEqual({
      category: 'Dashboard', action: 'Monitor', contents: 'Debt Maturities', cadence: 'Daily',
    })
    expect(parseGadgetTitle('Report · Test · Tidewater Covenants · Monthly')).toEqual({
      category: 'Report', action: 'Test', contents: 'Tidewater Covenants', cadence: 'Monthly',
    })
  })

  it('accepts the multi-word cadence and contents containing the separator', () => {
    expect(parseGadgetTitle('Agent · Draft · Lender Q&A · Replies · On Demand')).toEqual({
      category: 'Agent', action: 'Draft', contents: 'Lender Q&A · Replies', cadence: 'On Demand',
    })
  })

  it('returns the whole title as contents for anything else', () => {
    for (const title of [
      'Receipts Hold',
      'Memo · Draft · Something · Daily', // unknown category
      'Report · Test · Covenants · Biweekly', // unknown cadence
      'Report · Two Words · Covenants · Daily', // action must be one word
      'Report·Test·Covenants·Daily',
    ]) {
      expect(parseGadgetTitle(title)).toEqual({ contents: title })
    }
  })

  it('formats the secondary line only for convention titles', () => {
    expect(gadgetTitleDetail(parseGadgetTitle('Tracker · Watch · Draws · Weekly'))).toBe('Watch · Weekly')
    expect(gadgetTitleDetail(parseGadgetTitle('Receipts Hold'))).toBeUndefined()
  })
})

describe('groupWorkpieces', () => {
  const items: WorkpieceSummary[] = [
    { id: 1, type: 'gadget', title: 'Feed · Ingest · Mail · Live' },
    { id: 2, type: 'gadget', title: 'Report · Test · B · Monthly' },
    { id: 3, type: 'gadget', title: 'Loose title' },
    { id: 4, type: 'gadget', title: 'Dashboard · Monitor · A · Daily' },
    { id: 5, type: 'gadget', title: 'Report · Test · A · Monthly' },
    { id: 6, type: 'worktree', title: 'scratch', chatId: 1 } as WorkpieceSummary,
  ]

  it('orders groups by category, keeps input order within a group, puts the rest in Other', () => {
    const groups = groupWorkpieces(items)
    expect(groups.map(g => g.name)).toEqual(['Dashboard', 'Report', 'Feed', 'Other'])
    expect(groups[1].items.map(i => i.id)).toEqual([2, 5])
    expect(groups[3].items.map(i => i.id)).toEqual([3, 6])
  })

  it('matches queries against the full title, case-insensitively', () => {
    expect(matchesWorkpieceQuery(items[1], 'report · test')).toBe(true)
    expect(matchesWorkpieceQuery(items[1], 'MONTHLY')).toBe(true)
    expect(matchesWorkpieceQuery(items[1], 'daily')).toBe(false)
    expect(matchesWorkpieceQuery(items[1], '  ')).toBe(true)
  })
})
