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
    <section aria-label={label} className="flex flex-col gap-3">
      <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-kumo-inactive">
        {label}
      </h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {priorities.map((priority) => {
          const PriorityIcon = (priority.icon && PRIORITY_ICONS[priority.icon]) || Target
          return (
            <li key={`${priority.workspaceId}:${priority.workpieceId ?? ''}:${priority.label}`}>
              <Link
                to="/workspace/$id"
                params={{ id: priority.workspaceId }}
                search={priority.workpieceId === undefined ? {} : { w: priority.workpieceId }}
                className="group flex h-full flex-col gap-3 rounded-lg border border-kumo-line bg-kumo-elevated p-5 text-left transition-colors duration-150 hover:border-kumo-interact hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-base"
              >
                <span className="flex items-center justify-between">
                  <PriorityIcon size={20} weight="light" className="text-kumo-brand" />
                  <ArrowRight
                    size={14}
                    className="text-kumo-inactive transition-colors duration-150 group-hover:text-kumo-default"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold leading-5 tracking-[-0.1px] text-kumo-strong">
                    {priority.label}
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-5 text-kumo-subtle">
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
