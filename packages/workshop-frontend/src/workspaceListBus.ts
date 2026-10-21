/**
 * Tells listeners (the sidebar's workspace list) that workspace titles or membership may have
 * changed, so they refetch instead of showing the list as it was when the page loaded.
 */
export const WORKSPACES_CHANGED_EVENT = 'gadgets:workspaces-changed'

export function notifyWorkspacesChanged(): void {
  window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT))
}
