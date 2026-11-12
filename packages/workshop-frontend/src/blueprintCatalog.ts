import { parseGadgetTitle, type GadgetCategory } from './gadgetTitle'

// The Blueprints and Explore pages list blueprints as a catalog: grouped by what kind of thing a
// blueprint makes, each group under a heading that says so in a sentence. The kind comes from the
// title, which follows the gadget convention "Category · Action · Contents · Cadence" (see
// gadgetTitle.ts), so the catalog needs no stored category and a renamed blueprint moves itself.
// Bundled output formats (ids "format.*") make blank documents and get a group of their own.
// Anything else is listed whole under "More".

export type BlueprintGroupName = GadgetCategory | 'Documents' | 'More'

export const BLUEPRINT_GROUP_ORDER: readonly BlueprintGroupName[] = [
  'Dashboard', 'Tracker', 'Report', 'Analysis', 'Agent', 'Feed', 'Documents', 'More',
]

/** Heading and one-line explanation of each group, written for someone who has never built one. */
export const BLUEPRINT_GROUP_COPY: Record<BlueprintGroupName, { heading: string; blurb: string }> = {
  Dashboard: { heading: 'Dashboards', blurb: 'Live numbers on one screen. Open it to see where things stand.' },
  Tracker: { heading: 'Trackers', blurb: 'A list you work down. Each row is something to follow up or approve.' },
  Report: { heading: 'Reports', blurb: 'A finished report you can read, export or send.' },
  Analysis: { heading: 'Analysis', blurb: 'A study that answers one question about the portfolio.' },
  Agent: { heading: 'Agents', blurb: 'An assistant that does one job when you ask it to.' },
  Feed: { heading: 'Feeds', blurb: 'A running stream of new items as they arrive.' },
  Documents: { heading: 'Blank documents', blurb: 'An empty doc, sheet or slide deck to start writing in.' },
  More: { heading: 'More', blurb: 'Other starting points.' },
}

export interface CatalogEntry {
  id: string
  title: string
}

export interface CatalogGroup<T extends CatalogEntry> {
  name: BlueprintGroupName
  heading: string
  blurb: string
  items: T[]
}

/** The group a blueprint is listed under. */
export function groupOfBlueprint(entry: CatalogEntry): BlueprintGroupName {
  if (entry.id.startsWith('format.')) return 'Documents'
  return parseGadgetTitle(entry.title).category ?? 'More'
}

/** What a row leads with: the Contents of a convention title, or the whole title. */
export function blueprintDisplayName(title: string): string {
  return parseGadgetTitle(title).contents
}

/** The small label beside the name: "Monitor · Daily" for a convention title, else nothing. */
export function blueprintDisplayDetail(title: string): string | undefined {
  const parsed = parseGadgetTitle(title)
  return parsed.category ? `${parsed.action} · ${parsed.cadence}` : undefined
}

/**
 * Groups blueprints in BLUEPRINT_GROUP_ORDER, leaving out empty groups. Within a group, entries are
 * sorted by display name, so the same blueprint is always found in the same place.
 */
export function groupBlueprints<T extends CatalogEntry>(entries: readonly T[]): CatalogGroup<T>[] {
  const byGroup = new Map<BlueprintGroupName, T[]>()
  for (const entry of entries) {
    const name = groupOfBlueprint(entry)
    const items = byGroup.get(name)
    if (items) items.push(entry)
    else byGroup.set(name, [entry])
  }
  return BLUEPRINT_GROUP_ORDER.flatMap(name => {
    const items = byGroup.get(name)
    if (!items) return []
    const sorted = items.toSorted((a, b) =>
      blueprintDisplayName(a.title).localeCompare(blueprintDisplayName(b.title)))
    return [{ name, ...BLUEPRINT_GROUP_COPY[name], items: sorted }]
  })
}
