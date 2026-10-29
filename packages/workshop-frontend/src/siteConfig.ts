// Deployment copy and navigation, supplied at deploy time instead of patched into components.
//
// A deployment can inline a JSON block in index.html:
//   <script type="application/json" id="site-config">{ ... }</script>
// Home then shows the deployment's own headline and strategic priorities, and the sidebar groups
// workspaces the way the deployment organizes them. Without the block everything renders as
// upstream. Read once, synchronously, so nothing flashes from the default copy.

import type { WorkspacePlacement } from '@gadgets/workshop-shared/api'

/** A Home priority: a strategic theme that opens the workspace (and optionally the output) doing that work. */
export interface HomePriority {
  label: string
  description: string
  workspaceId: string
  /** Workpiece to open in the workspace, as its `?w=` id. */
  workpieceId?: number
  icon?: string
}

/** An entity under the deployment's name on Home, linked to its workspace when it has one. */
export interface HomeEntity {
  label: string
  workspaceId?: string
  /** External app the box opens instead of a workspace, as an https URL. */
  href?: string
  /** One line under the label, such as the app's tagline. */
  description?: string
  /** Site theme whose accent marks the entity's box ("back9"). */
  theme?: string
}

/** Deployment copy for Home. */
export interface HomeConfig {
  eyebrow?: string
  title: string
  subtitle?: string
  prioritiesLabel?: string
  priorities: HomePriority[]
  /** Entities shown under the headline, joined to it by connector lines. */
  entities?: HomeEntity[]
  /** Brand theme for Home, set as `data-workspace-theme` on <html> while Home is open. */
  theme?: string
  /** Home backdrop: "chevrons" (default) or "sketch", the Hub's San Francisco landmark etch. */
  backdrop?: HomeBackdropName
}

export const HOME_BACKDROPS = ['chevrons', 'sketch'] as const
export type HomeBackdropName = (typeof HOME_BACKDROPS)[number]

/** A labelled sidebar group of workspaces, listed in the given order. */
export interface NavGroup {
  label: string
  workspaceIds: string[]
  /** App pages listed at the top of the group, by key. Only "outputs" is known; it then leaves the primary nav. */
  links?: NavLink[]
  /** External apps listed after the group's workspaces, each opened in a new tab. */
  apps?: NavApp[]
}

/** An external app a nav group lists as a row, by label and https URL. */
export interface NavApp {
  label: string
  href: string
}

/** App pages a nav group can list alongside its workspaces. */
export const NAV_LINKS = ['outputs'] as const
export type NavLink = (typeof NAV_LINKS)[number]

/** Sidebar layout. */
export interface NavConfig {
  groups: NavGroup[]
  /** Put Workspaces, Blueprints, gatekeeper apps and Explore in one collapsible "Build" section. */
  buildSection?: boolean
  /** Place the Build section under this group's label instead of in the primary nav. */
  buildAfterGroup?: string
  /** Sidebar titles for gatekeeper apps, keyed by the title the gatekeeper gives ("Skills"). */
  appTitles?: Record<string, string>
}

/** Per-workspace settings, keyed by workspace id. */
export interface WorkspaceSiteConfig {
  /** Who answers in this workspace's chat, named in the composer ("Caddie"). */
  assistantName?: string
  /** Brand theme for the workspace chrome, set as `data-workspace-theme` on <html> while it is open. */
  theme?: string
}

/** Everything a deployment can set. */
export interface SiteConfig {
  home?: HomeConfig
  nav?: NavConfig
  workspaces?: Record<string, WorkspaceSiteConfig>
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isHttpsUrl = (v: unknown): v is string => {
  if (!isString(v)) return false
  try {
    return new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}
const isThemeName = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]+$/.test(v)

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

function parseEntity(v: unknown): HomeEntity | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (!isString(e.label)) return null
  return {
    label: e.label,
    ...(isString(e.workspaceId) ? { workspaceId: e.workspaceId } : {}),
    ...(isHttpsUrl(e.href) ? { href: e.href } : {}),
    ...(isString(e.description) ? { description: e.description } : {}),
    ...(isThemeName(e.theme) ? { theme: e.theme } : {}),
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
    ...(Array.isArray(h.entities)
      ? { entities: h.entities.map(parseEntity).filter((e): e is HomeEntity => e !== null) }
      : {}),
    ...(isThemeName(h.theme) ? { theme: h.theme } : {}),
    ...((HOME_BACKDROPS as readonly unknown[]).includes(h.backdrop)
      ? { backdrop: h.backdrop as HomeBackdropName }
      : {}),
  }
}

function parseNav(v: unknown): NavConfig | undefined {
  if (!v || typeof v !== 'object') return undefined
  const n = v as Record<string, unknown>
  const groups = Array.isArray(n.groups)
    ? n.groups.flatMap((g): NavGroup[] => {
      if (!g || typeof g !== 'object') return []
      const r = g as Record<string, unknown>
      if (!isString(r.label) || (!Array.isArray(r.workspaceIds) && !Array.isArray(r.apps))) return []
      const apps = Array.isArray(r.apps)
        ? r.apps.flatMap((a): NavApp[] => {
          if (!a || typeof a !== 'object') return []
          const e = a as Record<string, unknown>
          return isString(e.label) && isHttpsUrl(e.href) ? [{ label: e.label, href: e.href }] : []
        })
        : []
      const links = Array.isArray(r.links)
        ? r.links.filter((l): l is NavLink => (NAV_LINKS as readonly unknown[]).includes(l))
        : []
      return [{
        label: r.label,
        workspaceIds: Array.isArray(r.workspaceIds) ? r.workspaceIds.filter(isString) : [],
        ...(links.length > 0 ? { links } : {}),
        ...(apps.length > 0 ? { apps } : {}),
      }]
    })
    : []
  const appTitles = n.appTitles && typeof n.appTitles === 'object' && !Array.isArray(n.appTitles)
    ? Object.fromEntries(Object.entries(n.appTitles).filter((e): e is [string, string] => isString(e[1])))
    : undefined
  if (groups.length === 0 && n.buildSection !== true) return undefined
  return {
    groups,
    buildSection: n.buildSection === true,
    ...(isString(n.buildAfterGroup) ? { buildAfterGroup: n.buildAfterGroup } : {}),
    ...(appTitles ? { appTitles } : {}),
  }
}

function parseWorkspaces(v: unknown): Record<string, WorkspaceSiteConfig> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, WorkspaceSiteConfig> = {}
  for (const [id, entry] of Object.entries(v as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const settings: WorkspaceSiteConfig = {
      ...(isString(e.assistantName) ? { assistantName: e.assistantName } : {}),
      ...(isThemeName(e.theme) ? { theme: e.theme } : {}),
    }
    if (Object.keys(settings).length > 0) out[id] = settings
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Parses a site config object; unknown or malformed parts are dropped. */
export function parseSiteConfig(raw: unknown): SiteConfig {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  return { home: parseHome(r.home), nav: parseNav(r.nav), workspaces: parseWorkspaces(r.workspaces) }
}

/**
 * Layers the admin-approved workspace placements (ServerConfig.workspacePlacements) over a site
 * config: a placed workspace leaves whatever group the static config put it in and joins the group
 * with its label (a new group after the configured ones when no group has that label), and its
 * theme replaces the configured one. Returns `config` itself when there is nothing to layer, so
 * memoized callers keep a stable value.
 */
export function withWorkspacePlacements(
  config: SiteConfig,
  placements: Record<string, WorkspacePlacement> | undefined,
): SiteConfig {
  const entries = Object.entries(placements ?? {})
  if (entries.length === 0) return config
  const groups: NavGroup[] = (config.nav?.groups ?? []).map((g) => ({ ...g, workspaceIds: [...g.workspaceIds] }))
  const workspaces: Record<string, WorkspaceSiteConfig> = { ...config.workspaces }
  let grouped = false
  for (const [id, placement] of entries) {
    if (isString(placement.group)) {
      for (const g of groups) g.workspaceIds = g.workspaceIds.filter((w) => w !== id)
      let target = groups.find((g) => g.label === placement.group)
      if (!target) {
        target = { label: placement.group, workspaceIds: [] }
        groups.push(target)
      }
      target.workspaceIds.push(id)
      grouped = true
    }
    if (isThemeName(placement.theme)) workspaces[id] = { ...workspaces[id], theme: placement.theme }
  }
  return {
    ...config,
    ...(grouped ? { nav: { ...config.nav, groups } } : {}),
    ...(Object.keys(workspaces).length > 0 ? { workspaces } : {}),
  }
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
