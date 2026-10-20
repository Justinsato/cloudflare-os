// Deployment copy and navigation, supplied at deploy time instead of patched into components.
//
// A deployment can inline a JSON block in index.html:
//   <script type="application/json" id="site-config">{ ... }</script>
// Home then shows the deployment's own headline and strategic priorities, and the sidebar groups
// workspaces the way the deployment organizes them. Without the block everything renders as
// upstream. Read once, synchronously, so nothing flashes from the default copy.

/** A Home priority: a strategic theme that opens the workspace (and optionally the output) doing that work. */
export interface HomePriority {
  label: string
  description: string
  workspaceId: string
  /** Workpiece to open in the workspace, as its `?w=` id. */
  workpieceId?: number
  icon?: string
}

/** Deployment copy for Home. */
export interface HomeConfig {
  eyebrow?: string
  title: string
  subtitle?: string
  prioritiesLabel?: string
  priorities: HomePriority[]
}

/** A labelled sidebar group of workspaces, listed in the given order. */
export interface NavGroup {
  label: string
  workspaceIds: string[]
}

/** Sidebar layout. */
export interface NavConfig {
  groups: NavGroup[]
  /** Put Workspaces, Blueprints, gatekeeper apps and Explore in one collapsible "Build" section. */
  buildSection?: boolean
}

/** Everything a deployment can set. */
export interface SiteConfig {
  home?: HomeConfig
  nav?: NavConfig
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function parsePriority(v: unknown): HomePriority | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  if (!isString(p.label) || !isString(p.description) || !isString(p.workspaceId)) return null
  return {
    label: p.label,
    description: p.description,
    workspaceId: p.workspaceId,
    workpieceId: typeof p.workpieceId === 'number' ? p.workpieceId : undefined,
    icon: isString(p.icon) ? p.icon : undefined,
  }
}

function parseHome(v: unknown): HomeConfig | undefined {
  if (!v || typeof v !== 'object') return undefined
  const h = v as Record<string, unknown>
  if (!isString(h.title)) return undefined
  const priorities = Array.isArray(h.priorities)
    ? h.priorities.map(parsePriority).filter((p): p is HomePriority => p !== null)
    : []
  return {
    eyebrow: isString(h.eyebrow) ? h.eyebrow : undefined,
    title: h.title,
    subtitle: isString(h.subtitle) ? h.subtitle : undefined,
    prioritiesLabel: isString(h.prioritiesLabel) ? h.prioritiesLabel : undefined,
    priorities,
  }
}

function parseNav(v: unknown): NavConfig | undefined {
  if (!v || typeof v !== 'object') return undefined
  const n = v as Record<string, unknown>
  const groups = Array.isArray(n.groups)
    ? n.groups.flatMap((g): NavGroup[] => {
      if (!g || typeof g !== 'object') return []
      const r = g as Record<string, unknown>
      if (!isString(r.label) || !Array.isArray(r.workspaceIds)) return []
      return [{ label: r.label, workspaceIds: r.workspaceIds.filter(isString) }]
    })
    : []
  if (groups.length === 0 && n.buildSection !== true) return undefined
  return { groups, buildSection: n.buildSection === true }
}

/** Parses a site config object; unknown or malformed parts are dropped. */
export function parseSiteConfig(raw: unknown): SiteConfig {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  return { home: parseHome(r.home), nav: parseNav(r.nav) }
}

let cached: SiteConfig | null = null

/** The deployment's site config, read from the page once. Empty when none is inlined. */
export function siteConfig(): SiteConfig {
  if (cached) return cached
  let parsed: SiteConfig = {}
  try {
    const text = typeof document === 'undefined' ? null : document.getElementById('site-config')?.textContent
    if (text) parsed = parseSiteConfig(JSON.parse(text))
  } catch {
    parsed = {}
  }
  cached = parsed
  return parsed
}
