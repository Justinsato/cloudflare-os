import { useEffect } from 'react'
import { siteConfig } from './siteConfig'

/**
 * Applies the site config's brand theme for an open workspace by setting `data-workspace-theme` on
 * <html>, and clears it when the workspace closes. The deployment's stylesheet carries the tokens.
 */
export function useWorkspaceTheme(workspaceId: string | undefined) {
  const theme = workspaceId === undefined ? undefined : siteConfig().workspaces?.[workspaceId]?.theme
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    root.dataset.workspaceTheme = theme
    return () => {
      if (root.dataset.workspaceTheme === theme) delete root.dataset.workspaceTheme
    }
  }, [theme])
}
