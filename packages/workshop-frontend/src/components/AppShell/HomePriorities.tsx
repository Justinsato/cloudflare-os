import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
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
      <h3 className="px-1 text-[12px] font-medium uppercase tracking-[0.08em] text-kumo-inactive">
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
                className="press group flex h-full flex-col gap-3 rounded-xl border border-kumo-line bg-kumo-elevated p-4 text-left shadow-[0_1px_2px_rgba(9,36,64,0.04)] transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-kumo-interact hover:shadow-[0_6px_20px_-8px_rgba(9,36,64,0.18)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-kumo-ring/40"
              >
                <span className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-tint text-kumo-brand">
                    <PriorityIcon size={16} weight="duotone" />
                  </span>
                  <ArrowUpRight
                    size={14}
                    weight="bold"
                    className="text-kumo-inactive transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-kumo-default"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium leading-5 tracking-[-0.25px] text-kumo-strong">
                    {priority.label}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-[18px] tracking-[-0.15px] text-kumo-subtle">
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
