import { createContext, useContext, useState } from 'react'
import { CheckCircle, XCircle } from '@phosphor-icons/react'

/**
 * Sends a short reply into the open conversation, as if the person typed it. Provided by the chat
 * around its transcript so cards inside messages (the Caddie plan card) can answer the agent.
 */
export interface ChatQuickReply {
  send: (text: string) => void
  /** True while the agent is working, when a reply would queue behind the turn. */
  busy: boolean
}

/** The chat's quick-reply hook for cards inside messages; null outside a conversation. */
export const ChatQuickReplyContext = createContext<ChatQuickReply | null>(null)

/** A plan Caddie proposed, as the agent writes it in a ```caddie-plan block. */
export interface CaddiePlan {
  batch: string
  title: string
  workOrder?: string | null
  changes: string[]
  sends: string[]
  switches: string[]
  notes: string[]
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []

/** Parses a caddie-plan block's JSON; null when it isn't a usable plan. */
export function parseCaddiePlan(text: string): CaddiePlan | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (typeof raw.batch !== 'string' || raw.batch === '' || typeof raw.title !== 'string') return null
    return {
      batch: raw.batch,
      title: raw.title,
      workOrder: typeof raw.workOrder === 'string' ? raw.workOrder : null,
      changes: strings(raw.changes),
      sends: strings(raw.sends),
      switches: strings(raw.switches),
      notes: strings(raw.notes),
    }
  } catch {
    return null
  }
}

/** The reply text a decision sends; the agent instructions map it to caddieConfirm. */
export function caddieDecisionText(decision: 'confirm' | 'cancel', batch: string): string {
  return `${decision === 'confirm' ? 'Confirm' : 'Cancel'} Caddie plan ${batch}`
}

function Section({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-kumo-subtle">{label}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-[18px] text-kumo-default">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

/**
 * Caddie's proposed change, shown as a card with Confirm and Cancel. Nothing runs until the person
 * presses Confirm: the press sends "Confirm Caddie plan <batch>" and the agent then calls
 * BACK9.caddieConfirm. Caddie runs a batch at most once, so a repeated press is harmless.
 */
export default function CaddiePlanCard({ plan }: { plan: CaddiePlan }) {
  const reply = useContext(ChatQuickReplyContext)
  const [decided, setDecided] = useState<'confirm' | 'cancel' | null>(null)
  const decide = (decision: 'confirm' | 'cancel') => {
    if (!reply || decided) return
    setDecided(decision)
    reply.send(caddieDecisionText(decision, plan.batch))
  }
  const disabled = !reply || reply.busy || decided !== null

  return (
    <div className="not-prose my-2 rounded-xl border border-kumo-line bg-kumo-elevated p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-kumo-subtle">
        Caddie plan{plan.workOrder ? ` · ${plan.workOrder}` : ''}
      </p>
      <p className="mt-1 text-[14px] font-semibold leading-5 text-kumo-default">{plan.title}</p>
      <div className="mt-3 space-y-3">
        <Section label="Changes" items={plan.changes} />
        <Section label="Sends" items={plan.sends} />
        <Section label="Runs under" items={plan.switches} />
        <Section label="Will not" items={plan.notes} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        {decided ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-kumo-subtle">
            {decided === 'confirm' ? <CheckCircle size={15} /> : <XCircle size={15} />}
            {decided === 'confirm' ? 'Confirmed. Caddie is running it.' : 'Cancelled.'}
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => decide('confirm')}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-kumo-contrast px-3 text-[13px] font-medium text-kumo-inverse transition-colors hover:bg-kumo-strong disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-kumo-ring/40"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => decide('cancel')}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-kumo-ring/40"
            >
              Cancel
            </button>
            {reply?.busy && <span className="text-[12px] text-kumo-subtle">Available when Caddie finishes.</span>}
          </>
        )}
      </div>
    </div>
  )
}
