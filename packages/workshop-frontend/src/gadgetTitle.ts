import type { WorkpieceSummary } from '@gadgets/workshop-shared/api'
import { isWorkspaceHomeTitle } from '@gadgets/workshop-shared/gadget-order'

// Gadget titles follow the convention "Category · Action · Contents · Cadence", for example
// "Report · Test · Tidewater Covenants · Monthly". Navigation leads with the Contents, the part that
// tells two reports apart, and shows the rest as secondary text. Titles that don't follow the
// convention are shown whole under "Other". The Workspace Home gets a group of its own, "Home",
// listed above every category.

export const GADGET_CATEGORIES = ['Dashboard', 'Report', 'Tracker', 'Analysis', 'Agent', 'Feed'] as const
export type GadgetCategory = (typeof GADGET_CATEGORIES)[number]

/** A navigation group: "Home", one of the convention's categories, or "Other" for everything else. */
export type GadgetGroupName = 'Home' | GadgetCategory | 'Other'
export const GADGET_GROUP_ORDER: readonly GadgetGroupName[] = ['Home', ...GADGET_CATEGORIES, 'Other']

export interface ParsedGadgetTitle {
  category?: GadgetCategory
  action?: string
  contents: string
  cadence?: string
}

const TITLE_PATTERN =
  /^(Dashboard|Report|Tracker|Analysis|Agent|Feed) · (\w+) · (.+) · (Live|Daily|Weekly|Monthly|Quarterly|Annual|On Demand)$/

/** Splits a convention title into its parts; any other title comes back as `{ contents: title }`. */
export function parseGadgetTitle(title: string): ParsedGadgetTitle {
  const match = TITLE_PATTERN.exec(title)
  if (!match) return { contents: title }
  return {
    category: match[1] as GadgetCategory,
    action: match[2],
    contents: match[3],
    cadence: match[4],
  }
}

/** The muted secondary line under a row's Contents: "Action · Cadence", or nothing. */
export function gadgetTitleDetail(parsed: ParsedGadgetTitle): string | undefined {
  if (!parsed.category) return undefined
  return `${parsed.action} · ${parsed.cadence}`
}

export interface WorkpieceGroup<T extends WorkpieceSummary = WorkpieceSummary> {
  name: GadgetGroupName
  items: T[]
}

/**
 * The group a workpiece is listed under. The Workspace Home goes under "Home"; worktrees and
 * non-convention titles go under "Other".
 */
export function groupOfWorkpiece(workpiece: WorkpieceSummary): GadgetGroupName {
  if (workpiece.type !== 'gadget') return 'Other'
  if (isWorkspaceHomeTitle(workpiece.title)) return 'Home'
  return parseGadgetTitle(workpiece.title).category ?? 'Other'
}

/** Whether `query` matches the workpiece's full title (case-insensitive substring). */
export function matchesWorkpieceQuery(workpiece: WorkpieceSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || workpiece.title.toLowerCase().includes(q)
}

/**
 * Groups workpieces by category in GADGET_GROUP_ORDER, leaving out empty groups. Within a group the
 * input order is kept, so passing the workspace's saved gadget order keeps it.
 */
export function groupWorkpieces<T extends WorkpieceSummary>(workpieces: readonly T[]): WorkpieceGroup<T>[] {
  const byGroup = new Map<GadgetGroupName, T[]>()
  for (const workpiece of workpieces) {
    const name = groupOfWorkpiece(workpiece)
    const items = byGroup.get(name)
    if (items) items.push(workpiece)
    else byGroup.set(name, [workpiece])
  }
  return GADGET_GROUP_ORDER.flatMap(name => {
    const items = byGroup.get(name)
    return items ? [{ name, items }] : []
  })
}
