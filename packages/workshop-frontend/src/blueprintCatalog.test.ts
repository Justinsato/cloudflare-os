import { describe, expect, it } from 'vitest'
import {
  blueprintDisplayDetail, blueprintDisplayName, groupBlueprints, groupOfBlueprint,
} from './blueprintCatalog'

describe('blueprintCatalog', () => {
  it('groups by the category in a convention title', () => {
    expect(groupOfBlueprint({ id: 'a', title: 'Dashboard · Monitor · Collections · Daily' })).toBe('Dashboard')
    expect(groupOfBlueprint({ id: 'b', title: 'Tracker · Monitor · Code Violations · Live' })).toBe('Tracker')
  })

  it('lists bundled formats as blank documents and other titles under More', () => {
    expect(groupOfBlueprint({ id: 'format.document', title: 'Workspace Docs' })).toBe('Documents')
    expect(groupOfBlueprint({ id: 'c', title: 'Loan maturity watch' })).toBe('More')
  })

  it('leads with the contents and keeps action and cadence as detail', () => {
    expect(blueprintDisplayName('Report · Review · Units · Live')).toBe('Units')
    expect(blueprintDisplayDetail('Report · Review · Units · Live')).toBe('Review · Live')
    expect(blueprintDisplayName('Loan maturity watch')).toBe('Loan maturity watch')
    expect(blueprintDisplayDetail('Loan maturity watch')).toBeUndefined()
  })

  it('orders groups, drops empty ones and sorts each by name', () => {
    const groups = groupBlueprints([
      { id: '1', title: 'Report · Review · Units · Live' },
      { id: '2', title: 'Dashboard · Review · Rent Roll · Daily' },
      { id: '3', title: 'Dashboard · Monitor · Collections · Daily' },
      { id: 'format.slides', title: 'Workspace Slides' },
    ])
    expect(groups.map(g => g.name)).toEqual(['Dashboard', 'Report', 'Documents'])
    expect(groups[0].items.map(i => i.id)).toEqual(['3', '2'])
    expect(groups[0].heading).toBe('Dashboards')
    expect(groups[0].blurb).toMatch(/Live numbers/)
  })
})
