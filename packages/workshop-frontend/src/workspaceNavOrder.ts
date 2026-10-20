import type { NavGroup } from './siteConfig'

// The order and grouping of workspaces in the left nav, shared with the top-bar WorkspaceSwitcher so
// both list workspaces the same way: the deployment's configured groups in their configured order,
// then Favorites, then everything else (most recently active first in both).

export interface NavOrderWorkspace {
  id: string
  title: string
  pinned?: boolean
  lastActive: Date
}

export interface WorkspaceNavSections<T extends NavOrderWorkspace> {
  /** Configured groups with their matching workspaces, in configured order. May hold empty groups. */
  groups: { label: string; items: T[] }[]
  favorites: T[]
  /** Workspaces in no group and not pinned. */
  recent: T[]
  /** "Other workspaces" when the deployment defines groups, else "Recent workspaces". */
  recentLabel: string
}

const byActive = (a: NavOrderWorkspace, b: NavOrderWorkspace) =>
  b.lastActive.getTime() - a.lastActive.getTime()

export function workspaceNavSections<T extends NavOrderWorkspace>(
  workspaces: readonly T[],
  navGroups: readonly NavGroup[],
  matches: (w: T) => boolean = () => true,
): WorkspaceNavSections<T> {
  const byId = new Map(workspaces.map((w) => [w.id, w]))
  // Workspaces in a group leave Favorites and Recent, so each appears once.
  const groupedIds = new Set(navGroups.flatMap((g) => g.workspaceIds))
  const groups = navGroups.map((group) => ({
    label: group.label,
    items: group.workspaceIds
      .map((id) => byId.get(id))
      .filter((w): w is T => w !== undefined && matches(w)),
  }))
  const favorites: T[] = []
  const recent: T[] = []
  for (const w of workspaces) {
    if (groupedIds.has(w.id) || !matches(w)) continue
    if (w.pinned) favorites.push(w)
    else recent.push(w)
  }
  return {
    groups,
    favorites: favorites.toSorted(byActive),
    recent: recent.toSorted(byActive),
    recentLabel: navGroups.length > 0 ? 'Other workspaces' : 'Recent workspaces',
  }
}

/** The non-empty sections as a flat, labelled list, in nav order. */
export function workspaceNavList<T extends NavOrderWorkspace>(sections: WorkspaceNavSections<T>) {
  return [
    ...sections.groups.map((g) => ({ name: g.label, items: g.items })),
    { name: 'Favorites', items: sections.favorites },
    { name: sections.recentLabel, items: sections.recent },
  ].filter((s) => s.items.length > 0)
}
