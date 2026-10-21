import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Legacy URL. Context & Skills used to be a "coming soon" preview here; the real library is the
 * Context gatekeeper's app at /gatekeepers/context, which is where the nav entry points. Redirect
 * old links there.
 */
export const Route = createFileRoute('/context')({
  beforeLoad: () => {
    throw redirect({
      to: '/gatekeepers/$appId',
      params: { appId: 'context' },
      replace: true,
    })
  },
  component: () => null,
})
