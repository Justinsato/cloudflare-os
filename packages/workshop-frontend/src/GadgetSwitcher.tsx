import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, Check, GitBranch, MagnifyingGlass } from '@phosphor-icons/react'
import type { WorkpieceId, WorkpieceSummary } from '@gadgets/workshop-shared/api'
import { FormatGlyph } from './components/format/FormatVisuals'
import { isImeComposing } from './keyboardEvent'
import {
  gadgetTitleDetail, groupWorkpieces, matchesWorkpieceQuery, parseGadgetTitle,
} from './gadgetTitle'

// The workspace pane's navigator: one button naming the open workpiece, opening a searchable list
// of every workpiece grouped by category. Replaces the old row of tabs, whose titles truncated to
// "Dashboard · Monito…" and so could not tell reports apart.

function SwitcherGlyph({ workpiece, className }: { workpiece: WorkpieceSummary; className?: string }) {
  if (workpiece.type === 'worktree') return <GitBranch size={13} className={className} />
  return <FormatGlyph output={workpiece.output} size="sm" className={className} weight="regular" />
}

const isDraft = (workpiece: WorkpieceSummary) =>
  workpiece.type === 'gadget' && workpiece.chatId !== undefined

export interface GadgetSwitcherProps {
  // In the workspace's saved order; the list keeps that order within each group.
  workpieces: readonly WorkpieceSummary[]
  selectedId: WorkpieceId | null
  onSelect: (id: WorkpieceId) => void
}

export default function GadgetSwitcher({ workpieces, selectedId, onSelect }: GadgetSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // The pane header clips overflow, so the list is portalled to the body and placed under the
  // button by hand.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (id: WorkpieceId) => `${baseId}-opt-${id}`

  const selected = workpieces.find(w => w.id === selectedId)
  const parsed = selected ? parseGadgetTitle(selected.title) : undefined

  const groups = useMemo(
    () => groupWorkpieces(workpieces.filter(w => matchesWorkpieceQuery(w, query))),
    [workpieces, query])
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  const openList = () => {
    setQuery('')
    const index = workpieces.length > 0
      ? groupWorkpieces(workpieces).flatMap(g => g.items).findIndex(w => w.id === selectedId)
      : -1
    setActiveIndex(Math.max(0, index))
    const rect = buttonRef.current?.getBoundingClientRect()
    setAnchor(rect ? { top: rect.bottom + 6, left: rect.left } : null)
    setOpen(true)
  }

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const choose = (id: WorkpieceId) => {
    close()
    onSelect(id)
  }

  // Cmd/Ctrl+K toggles the list anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        if (open) close()
        else openList()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // A click outside closes the list without moving focus back.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the keyboard-highlighted option in view.
  useEffect(() => {
    if (!open) return
    const active = flat[activeIndex]
    if (!active) return
    const el = listRef.current?.querySelector<HTMLElement>(`[id="${optionId(active.id)}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex, flat])

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length > 0) setActiveIndex(i => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length > 0) setActiveIndex(i => (i - 1 + flat.length) % flat.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(Math.max(0, flat.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const active = flat[activeIndex]
      if (active) choose(active.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  const activeOption = flat[activeIndex]
  let flatIndex = 0

  return (
    <div ref={rootRef} className="relative flex min-w-0 max-w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={selected ? `Switch output, current: ${selected.title}` : 'Switch output'}
        title={selected?.title}
        className="flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg bg-kumo-tint px-2.5 py-1 text-left text-kumo-default transition-colors duration-150 hover:bg-kumo-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
      >
        {selected && <SwitcherGlyph workpiece={selected} className="flex-shrink-0 text-kumo-subtle" />}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold tracking-[-0.15px]">
            {parsed?.contents ?? 'Select an output'}
          </span>
          {parsed?.category && (
            <span className="truncate text-[11px] text-kumo-subtle">
              {parsed.category} · {parsed.action} · {parsed.cadence}
            </span>
          )}
        </span>
        {selected && isDraft(selected) && (
          <span className="flex-shrink-0 rounded-full bg-kumo-fill px-1.5 py-0.5 text-[10px] font-medium leading-none text-kumo-subtle">
            Draft
          </span>
        )}
        <CaretDown size={12} weight="bold" className="flex-shrink-0 text-kumo-subtle" />
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          style={{
            top: anchor?.top ?? 56,
            left: Math.max(16, Math.min(anchor?.left ?? 16, window.innerWidth - 476)),
          }}
          className="fixed z-50 flex max-h-[min(70vh,560px)] w-[min(460px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-kumo-line bg-kumo-base shadow-lg"
        >
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-kumo-line px-3">
            <MagnifyingGlass size={14} className="flex-shrink-0 text-kumo-inactive" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
              aria-label="Search outputs"
              placeholder="Search outputs"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onInputKeyDown}
              className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-kumo-default outline-none placeholder:text-kumo-inactive"
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Outputs"
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {flat.length === 0 && (
              <div className="px-2 py-6 text-center text-[13px] text-kumo-subtle">No matching outputs</div>
            )}
            {groups.map(group => {
              const headingId = `${baseId}-group-${group.name}`
              return (
                <div key={group.name} role="group" aria-labelledby={headingId} className="mb-1 last:mb-0">
                  <div
                    id={headingId}
                    className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-kumo-inactive"
                  >
                    {group.name}
                  </div>
                  {group.items.map(workpiece => {
                    const index = flatIndex++
                    const isActive = index === activeIndex
                    const isSelected = workpiece.id === selectedId
                    const itemParsed = parseGadgetTitle(workpiece.title)
                    const detail = gadgetTitleDetail(itemParsed)
                    return (
                      <div
                        key={workpiece.id}
                        id={optionId(workpiece.id)}
                        role="option"
                        aria-selected={isSelected}
                        title={workpiece.title}
                        data-active={isActive ? 'true' : undefined}
                        onMouseMove={() => { if (!isActive) setActiveIndex(index) }}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => choose(workpiece.id)}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 ${
                          isActive ? 'bg-kumo-tint' : ''
                        }`}
                      >
                        <SwitcherGlyph workpiece={workpiece} className="mt-0.5 flex-shrink-0 text-kumo-subtle" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="break-words text-[13px] font-medium leading-[18px] text-kumo-default">
                            {itemParsed.contents}
                          </span>
                          {detail && (
                            <span className="text-[11px] leading-4 text-kumo-subtle">{detail}</span>
                          )}
                        </span>
                        {isDraft(workpiece) && (
                          <span className="mt-0.5 flex-shrink-0 rounded-full bg-kumo-fill px-1.5 py-0.5 text-[10px] font-medium leading-none text-kumo-subtle">
                            Draft
                          </span>
                        )}
                        <Check
                          size={14}
                          weight="bold"
                          aria-hidden="true"
                          className={`mt-0.5 flex-shrink-0 text-kumo-brand ${isSelected ? '' : 'invisible'}`}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
