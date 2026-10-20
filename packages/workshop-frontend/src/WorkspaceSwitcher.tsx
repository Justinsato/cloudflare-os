import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, Check, MagnifyingGlass, Star } from '@phosphor-icons/react'
import { isImeComposing } from './keyboardEvent'

// The workspace name in the top bar, as a menu of every workspace the user can open. Picking one
// navigates there. Same combobox pattern as GadgetSwitcher: a search box that filters as you type,
// arrows to move, Enter to open, Escape to close.

export interface WorkspaceSwitcherItem {
  id: string
  title: string
  pinned?: boolean
  owner?: { name: string }
}

export interface WorkspaceSwitcherProps {
  currentId: string
  /** The open workspace's live title, so a rename shows before the list is reloaded. */
  currentTitle: string
  /** Fetched each time the list opens, so new, renamed and removed workspaces are current. */
  loadWorkspaces: () => Promise<WorkspaceSwitcherItem[]>
  onSelect: (id: string) => void
}

const untitled = (title: string) => title.trim() || 'Untitled workspace'
const byTitle = (a: WorkspaceSwitcherItem, b: WorkspaceSwitcherItem) =>
  untitled(a.title).localeCompare(untitled(b.title), undefined, { sensitivity: 'base' })

/** Favorites first, then everything else, each alphabetical. Exported for tests. */
export function groupWorkspaces(items: readonly WorkspaceSwitcherItem[], query: string) {
  const needle = query.trim().toLowerCase()
  const shown = items.filter(w => !needle || untitled(w.title).toLowerCase().includes(needle))
  const favorites = shown.filter(w => w.pinned).toSorted(byTitle)
  const rest = shown.filter(w => !w.pinned).toSorted(byTitle)
  if (favorites.length === 0) return rest.length ? [{ name: 'Workspaces', items: rest }] : []
  return [
    { name: 'Favorites', items: favorites },
    ...(rest.length ? [{ name: 'Workspaces', items: rest }] : []),
  ]
}

export default function WorkspaceSwitcher({
  currentId, currentTitle, loadWorkspaces, onSelect,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [workspaces, setWorkspaces] = useState<WorkspaceSwitcherItem[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // The top bar clips overflow, so the list is portalled to the body and placed under the button.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-opt-${index}`

  // Always list the open workspace under its live title, even when the account list leaves it out
  // (a workspace opened from a share link appears there only after its first open).
  const withCurrent = (list: readonly WorkspaceSwitcherItem[]) => {
    const merged = list.map(w => (w.id === currentId ? { ...w, title: currentTitle } : w))
    if (!merged.some(w => w.id === currentId)) merged.push({ id: currentId, title: currentTitle })
    return merged
  }
  const items = useMemo(
    () => (workspaces ? withCurrent(workspaces) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, currentId, currentTitle])

  const groups = useMemo(() => groupWorkspaces(items, query), [items, query])
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  const highlightCurrent = (list: readonly WorkspaceSwitcherItem[]) => {
    const index = groupWorkspaces(list, '').flatMap(g => g.items).findIndex(w => w.id === currentId)
    setActiveIndex(Math.max(0, index))
  }

  // Each open fetches a fresh list; a late reply from an earlier open is dropped.
  const loadSeq = useRef(0)
  const queryRef = useRef(query)
  queryRef.current = query
  const openList = () => {
    setQuery('')
    highlightCurrent(items)
    const rect = buttonRef.current?.getBoundingClientRect()
    setAnchor(rect ? { top: rect.bottom + 6, left: rect.left } : null)
    setOpen(true)
    setLoadFailed(false)
    const seq = ++loadSeq.current
    loadWorkspaces().then(
      list => {
        if (seq !== loadSeq.current) return
        setWorkspaces(list)
        // Start on the open workspace, unless the user has already started filtering.
        if (!queryRef.current) highlightCurrent(withCurrent(list))
      },
      () => {
        if (seq !== loadSeq.current) return
        setLoadFailed(true)
      },
    )
  }

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const choose = (id: string) => {
    close(id === currentId)
    if (id !== currentId) onSelect(id)
  }

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
    const el = listRef.current?.querySelector<HTMLElement>(`[id="${optionId(activeIndex)}"]`)
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
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      openList()
    }
  }

  const activeOption = flat[activeIndex]
  const title = untitled(currentTitle)
  let flatIndex = 0

  return (
    <div ref={rootRef} className="relative flex min-w-0 max-w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Switch workspace, current: ${title}`}
        title={title}
        className="flex h-9 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 text-left text-kumo-default transition-colors duration-150 hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring md:h-7"
      >
        <span className="truncate text-[14px] font-medium leading-5 tracking-[-0.25px]">{title}</span>
        <CaretDown size={12} weight="bold" className="flex-shrink-0 text-kumo-subtle" />
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          style={{
            top: anchor?.top ?? 56,
            left: Math.max(16, Math.min(anchor?.left ?? 16, window.innerWidth - 376)),
          }}
          className="fixed z-[1100] flex max-h-[min(70vh,480px)] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-kumo-line bg-kumo-base shadow-lg"
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
              aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
              aria-label="Search workspaces"
              placeholder="Search workspaces"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onInputKeyDown}
              className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-kumo-default outline-none placeholder:text-kumo-inactive md:h-10 md:text-[13px]"
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Workspaces"
            aria-busy={workspaces === null && !loadFailed}
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {workspaces === null && !loadFailed && (
              <div className="px-2 py-6 text-center text-[13px] text-kumo-subtle">Loading workspaces…</div>
            )}
            {workspaces === null && loadFailed && (
              <div className="px-2 py-6 text-center text-[13px] text-kumo-subtle">Couldn&apos;t load workspaces</div>
            )}
            {workspaces !== null && flat.length === 0 && (
              <div className="px-2 py-6 text-center text-[13px] text-kumo-subtle">No matching workspaces</div>
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
                  {group.items.map(workspace => {
                    const index = flatIndex++
                    const isActive = index === activeIndex
                    const isCurrent = workspace.id === currentId
                    const name = untitled(workspace.title)
                    return (
                      <div
                        key={workspace.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={isCurrent}
                        aria-current={isCurrent ? 'page' : undefined}
                        title={name}
                        data-workspace-id={workspace.id}
                        data-active={isActive ? 'true' : undefined}
                        onMouseMove={() => { if (!isActive) setActiveIndex(index) }}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => choose(workspace.id)}
                        className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 md:min-h-0 ${
                          isActive ? 'bg-kumo-tint' : ''
                        }`}
                      >
                        {workspace.pinned
                          ? <Star size={13} weight="fill" aria-hidden="true" className="flex-shrink-0 text-kumo-inactive" />
                          : <span aria-hidden="true" className="w-[13px] flex-shrink-0" />}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={`break-words text-[13px] leading-[18px] text-kumo-default ${isCurrent ? 'font-semibold' : 'font-medium'}`}>
                            {name}
                          </span>
                          {workspace.owner && (
                            <span className="text-[11px] leading-4 text-kumo-subtle">by {workspace.owner.name}</span>
                          )}
                        </span>
                        <Check
                          size={14}
                          weight="bold"
                          aria-hidden="true"
                          className={`flex-shrink-0 text-kumo-brand ${isCurrent ? '' : 'invisible'}`}
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
