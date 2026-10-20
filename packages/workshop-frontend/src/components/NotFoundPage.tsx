import { Link } from '@tanstack/react-router'
import { MagnifyingGlass } from '@phosphor-icons/react'

/**
 * Shown for any URL that matches no route. Styled like the app's other empty states and gives a way
 * back, instead of the router's bare "Not Found" text.
 */
export default function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kumo-fill text-kumo-subtle">
        <MagnifyingGlass size={18} />
      </div>
      <div>
        <p className="text-sm font-medium text-kumo-default">Page not found</p>
        <p className="mt-1 text-[13px] leading-[18px] text-kumo-subtle">
          This address doesn't match any page.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/"
          className="inline-flex h-8 items-center rounded-lg bg-kumo-contrast px-3 text-[13px] font-medium text-kumo-inverse transition-colors hover:bg-kumo-strong focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-kumo-ring/40"
        >
          Go to Home
        </Link>
        <Link
          to="/workspaces"
          className="inline-flex h-8 items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-elevated focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-kumo-ring/40"
        >
          Workspaces
        </Link>
      </div>
    </div>
  )
}
