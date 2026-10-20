// Two-letter monogram for a workspace avatar. Connecting words are skipped so "Library and Lists"
// reads LL and "Admin and Settings" reads AS, not LA and AA.
const SKIPPED_WORDS = new Set(['and', '&', 'of', 'the', 'for', '+', '-', '·'])

/** The monogram shown in a workspace's avatar tile. */
export function workspaceMonogram(title: string | undefined): string {
  const t = title?.trim() || 'Untitled'
  const words = t.split(/\s+/).filter((w) => !SKIPPED_WORDS.has(w.toLowerCase()))
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  return letters || t.slice(0, 2).toUpperCase()
}
