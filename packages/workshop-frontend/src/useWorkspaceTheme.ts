import { useEffect } from 'react'
import { siteConfig } from './siteConfig'

/**
 * Sets a site-config brand theme as `data-workspace-theme` on <html> while the calling page is open,
 * and clears it on leaving. The deployment's stylesheet carries the tokens.
 */
export function useSiteTheme(theme: string | undefined) {
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    root.dataset.workspaceTheme = theme
    return () => {
      if (root.dataset.workspaceTheme === theme) delete root.dataset.workspaceTheme
    }
  }, [theme])
}

/** The site config's theme for an open workspace. */
export function useWorkspaceTheme(workspaceId: string | undefined) {
  useSiteTheme(workspaceId === undefined ? undefined : siteConfig().workspaces?.[workspaceId]?.theme)
}
