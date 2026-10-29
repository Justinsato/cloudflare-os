import { useMemo } from 'react'
import { useServerConfig } from './ServerConfigContext'
import { siteConfig, withWorkspacePlacements, type SiteConfig } from './siteConfig'

/**
 * The deploy-time site config with the admin-approved workspace placements from the server config
 * layered over it (see withWorkspacePlacements). Before the server config loads, the static config.
 */
export function useSiteConfig(): SiteConfig {
  const placements = useServerConfig()?.workspacePlacements
  return useMemo(() => withWorkspacePlacements(siteConfig(), placements), [placements])
}
