// Brick: workspaces that agents and the MCP portal create, and where they sit in the sidebar.
//
// A deployment's sidebar groups and per-workspace themes come from the site config inlined into
// index.html at deploy time, so a workspace created at runtime would otherwise stay in the
// ungrouped list until someone edits the theme and redeploys the router. Placements fill that gap:
// an admin-approved {group, theme} per workspace, kept under one reserved BLUEPRINTS KV key (like
// the admin config's mirror) and published to clients through ServerConfig.workspacePlacements,
// where the frontend layers them over the static site config.

import type { WorkspacePlacement } from "@gadgets/workshop-shared/api";

/** The reserved BLUEPRINTS KV key holding every placement. */
export const WORKSPACE_PLACEMENTS_KEY = "__brick_workspace_placements__";

export const MAX_WORKSPACE_TITLE = 120;
const MAX_GROUP_LABEL = 60;

// The naming convention (Category · Action · Contents · Cadence) never prefixes a title with the
// platform or entity brand: the sidebar already says which OS it is.
const RESERVED_TITLE_PREFIX = /^(mofo|brick|back9)\b/i;

/**
 * Validate and trim a workspace title, throwing an agent-readable error. Used by every Brick path
 * that names a workspace (createWorkspace, renameWorkspace, the MCP portal).
 */
export function validateWorkspaceTitle(title: unknown): string {
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("A workspace requires a non-empty title.");
  }
  let trimmed = title.trim();
  if (trimmed.length > MAX_WORKSPACE_TITLE) {
    throw new Error(`The title is too long (${trimmed.length} characters; at most ` +
                    `${MAX_WORKSPACE_TITLE}).`);
  }
  if (RESERVED_TITLE_PREFIX.test(trimmed)) {
    throw new Error("Workspace titles follow Category · Action · Contents · Cadence and never " +
                    "start with Mofo, Brick or Back9. Drop the prefix.");
  }
  return trimmed;
}

/**
 * Validate a placement, throwing an agent-readable error. Returns it trimmed, or null when it sets
 * nothing.
 */
export function validatePlacement(placement: {group?: unknown, theme?: unknown})
    : WorkspacePlacement | null {
  let out: WorkspacePlacement = {};
  if (placement.group !== undefined && placement.group !== null) {
    if (typeof placement.group !== "string" || !placement.group.trim()) {
      throw new Error("A nav group must be a non-empty label.");
    }
    let group = placement.group.trim();
    if (group.length > MAX_GROUP_LABEL) {
      throw new Error(`The nav group label is too long (at most ${MAX_GROUP_LABEL} characters).`);
    }
    out.group = group;
  }
  if (placement.theme !== undefined && placement.theme !== null) {
    if (typeof placement.theme !== "string" || !/^[a-z0-9-]{1,40}$/.test(placement.theme)) {
      throw new Error("A theme is a site theme name: lowercase letters, digits and hyphens " +
                      "(\"dual\", \"back9\").");
    }
    out.theme = placement.theme;
  }
  return out.group || out.theme ? out : null;
}

function parsePlacements(raw: string | null): Record<string, WorkspacePlacement> {
  if (!raw) return {};
  try {
    let parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    let out: Record<string, WorkspacePlacement> = {};
    for (let [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      try {
        let placement = validatePlacement(value as {group?: unknown, theme?: unknown});
        if (placement) out[id] = placement;
      } catch {
        // A malformed entry is dropped rather than failing every client's boot.
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Every placement. Cheap enough for getServerConfig's hot path (a single KV get). */
export async function readWorkspacePlacements(env: Cloudflare.Env)
    : Promise<Record<string, WorkspacePlacement>> {
  return parsePlacements(await env.BLUEPRINTS.get(WORKSPACE_PLACEMENTS_KEY));
}

/**
 * Set or (with null) clear one workspace's placement. A read-modify-write of one KV value: two
 * admins approving placements in the same instant could lose one, which is acceptable for a
 * low-volume, admin-only write (the loser re-approves).
 */
export async function writeWorkspacePlacement(env: Cloudflare.Env, workspaceId: string,
                                              placement: WorkspacePlacement | null): Promise<void> {
  let all = await readWorkspacePlacements(env);
  if (placement) {
    all[workspaceId] = placement;
  } else {
    delete all[workspaceId];
  }
  await env.BLUEPRINTS.put(WORKSPACE_PLACEMENTS_KEY, JSON.stringify(all));
}

/** Whether `name` (a user DO name: the sign-in email) is a deployment admin (env.ADMINS). */
export function isAdminName(env: Cloudflare.Env, name: string | undefined): boolean {
  let admins = env.ADMINS;
  if (!name || !admins) return false;
  if (typeof admins === "string") {
    // Admins should be a JSON binding of array type, but `.env` doesn't actually let you
    // specify JSON bindings, so we also support a string that parses as JSON array.
    admins = JSON.parse(admins);
  }
  if (!Array.isArray(admins)) {
    throw new TypeError("ADMINS must be configured as an array of usernames.");
  }
  return admins.includes(name);
}

/** The path that opens a workspace in the Workshop. */
export function workspaceUrl(workspaceId: string): string {
  return `/workspace/${workspaceId}`;
}
