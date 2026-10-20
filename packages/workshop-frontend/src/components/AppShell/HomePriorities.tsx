import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Bank,
  Briefcase,
  Buildings,
  ChartLineUp,
  Handshake,
  Scales,
  Target,
  type Icon,
} from '@phosphor-icons/react'
import type { HomePriority } from '../../siteConfig'

// Icons a deployment can name in its site config. Anything else falls back to Target.
const PRIORITY_ICONS: Record<string, Icon> = {
  bank: Bank,
  briefcase: Briefcase,
  buildings: Buildings,
  chart: ChartLineUp,
  handshake: Handshake,
  scales: Scales,
  target: Target,
}

/**
 * The deployment's strategic priorities under the Home composer. Each one opens the workspace, and
 * the output inside it when the config names one, where that work happens.
 */
export default function HomePriorities({
  label,
  priorities,
}: {
  label: string
  priorities: HomePriority[]
}) {
  if (priorities.length === 0) return null
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h3 className="px-1 pb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-kumo-inactive">
        {label}
      </h3>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {priorities.map((priority) => {
          const PriorityIcon = (priority.icon && PRIORITY_ICONS[priority.icon]) || Target
          return (
            <li key={`${priority.workspaceId}:${priority.workpieceId ?? ''}:${priority.label}`}>
              <Link
                to="/workspace/$id"
                params={{ id: priority.workspaceId }}
                search={priority.workpieceId === undefined ? {} : { w: priority.workpieceId }}
                className="press group flex h-full items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-kumo-line hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-kumo-ring/40"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-fill text-kumo-subtle transition-colors group-hover:text-kumo-default">
                  <PriorityIcon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-[13px] font-medium leading-[18px] tracking-[-0.25px] text-kumo-default">
                    {priority.label}
                    <ArrowRight
                      size={11}
                      weight="bold"
                      className="shrink-0 text-kumo-inactive opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-4 tracking-[-0.2px] text-kumo-subtle">
                    {priority.description}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
