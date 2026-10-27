import { Link } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react'
import type { CSSProperties } from 'react'
import type { HomeEntity } from '../../siteConfig'

/**
 * The deployment's entities under the Home headline, drawn as an org chart: a stem from the
 * headline, a rail across, and a drop into each box. A box with a workspace opens it; one without
 * is visibly inert. A box with an app link opens that app in a new tab. A box whose entity has its own theme ("back9") takes that brand's accent on its
 * top edge and drop line.
 */
export default function HomeEntities({ entities }: { entities: HomeEntity[] }) {
  if (entities.length === 0) return null
  // Up to six across, so an app row reads as one line on desktop.
  const columns = Math.min(entities.length, 6)
  // The rail runs between the centers of the first and last column. Past four, the row wraps to
  // three across below lg, so the org-chart lines only show where every box sits on the one rail.
  const inset = `${50 / columns}%`
  const wide = columns > 4
  const lines = wide ? 'hidden lg:block' : 'hidden sm:block'
  return (
    <nav aria-label="Entities" className="flex w-full flex-col items-center">
      <span aria-hidden="true" className={`${lines} h-6 w-px bg-kumo-interact`} />
      <div className="relative w-full">
        <span
          aria-hidden="true"
          className={`${lines} absolute top-0 h-px bg-kumo-interact`}
          style={{ left: inset, right: inset }}
        />
        <ul
          className={wide
            ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-[repeat(var(--entity-columns),minmax(0,1fr))]'
            : 'grid grid-cols-2 gap-3 sm:grid-cols-[repeat(var(--entity-columns),minmax(0,1fr))] sm:gap-4'}
          style={{ '--entity-columns': columns } as CSSProperties}
        >
          {entities.map((entity) => {
            const accent = entity.theme === 'back9' ? 'var(--home-line-2)' : 'var(--home-line-1)'
            const box = (
              <>
                <span className="block text-[15px] font-semibold leading-5 tracking-[-0.1px] text-kumo-strong">
                  {entity.label}
                </span>
                {entity.description && (
                  <span className="mt-1 block text-[12px] leading-4 text-kumo-subtle">{entity.description}</span>
                )}
                <span className="mt-2 flex items-center gap-1 text-[12px] leading-4 text-kumo-inactive">
                  {entity.href && !entity.workspaceId ? (
                    <>
                      Open app
                      <ArrowUpRight size={12} className="transition-colors group-hover:text-kumo-default" />
                    </>
                  ) : entity.workspaceId ? (
                    <>
                      Open workspace
                      <ArrowRight size={12} className="transition-colors group-hover:text-kumo-default" />
                    </>
                  ) : 'No workspace yet'}
                </span>
              </>
            )
            const linkClass = 'transition-colors duration-150 hover:border-kumo-interact hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-base'
            const boxClass = 'block h-full rounded-lg border border-t-2 border-kumo-line bg-kumo-elevated px-4 py-3.5 text-left'
            return (
              <li key={entity.label} className="flex flex-col items-center">
                <span aria-hidden="true" className={`${lines} h-5 w-px`} style={{ background: accent }} />
                <div className="w-full flex-1">
                  {entity.workspaceId ? (
                    <Link
                      to="/workspace/$id"
                      params={{ id: entity.workspaceId }}
                      className={`group ${boxClass} ${linkClass}`}
                      style={{ borderTopColor: accent }}
                    >
                      {box}
                    </Link>
                  ) : entity.href ? (
                    <a
                      href={entity.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`group ${boxClass} ${linkClass}`}
                      style={{ borderTopColor: accent }}
                    >
                      {box}
                    </a>
                  ) : (
                    <div className={boxClass} style={{ borderTopColor: accent }} aria-disabled="true">
                      {box}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
