// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceSwitcher, { groupWorkspaces, type WorkspaceSwitcherItem } from './WorkspaceSwitcher'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACES: WorkspaceSwitcherItem[] = [
  { id: 'prop', title: 'Property Operations' },
  { id: 'port', title: 'Portfolio Management', pinned: true },
  { id: 'back9', title: 'Back9 Trades', owner: { name: 'Pat Doe' } },
  { id: 'cap', title: 'Capital Markets' },
  { id: 'lib', title: 'Library and Lists', pinned: true },
]

describe('groupWorkspaces', () => {
  it('puts favorites first, each group alphabetical', () => {
    expect(groupWorkspaces(WORKSPACES, '').map(g => [g.name, g.items.map(w => w.id)])).toEqual([
      ['Favorites', ['lib', 'port']],
      ['Workspaces', ['back9', 'cap', 'prop']],
    ])
  })

  it('drops the Favorites group when nothing pinned matches', () => {
    expect(groupWorkspaces(WORKSPACES, 'trades').map(g => g.name)).toEqual(['Workspaces'])
    expect(groupWorkspaces(WORKSPACES, 'zzz')).toEqual([])
  })
})

describe('WorkspaceSwitcher', () => {
  let root: Root | undefined
  let container: HTMLElement

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
  })

  async function render({
    currentId = 'cap',
    currentTitle = 'Capital Markets',
    load = vi.fn<() => Promise<WorkspaceSwitcherItem[]>>(async () => WORKSPACES),
  }: { currentId?: string; currentTitle?: string; load?: () => Promise<WorkspaceSwitcherItem[]> } = {}) {
    const onSelect = vi.fn<(id: string) => void>()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <WorkspaceSwitcher
        currentId={currentId}
        currentTitle={currentTitle}
        loadWorkspaces={load}
        onSelect={onSelect}
      />,
    ))
    return { onSelect, load }
  }

  const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
  const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')
  const search = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
  const optionIds = () => options().map(o => o.dataset.workspaceId)
  const activeId = () => document.getElementById(search().getAttribute('aria-activedescendant')!)!.dataset.workspaceId

  async function open() {
    await act(async () => trigger().click())
  }

  async function type(value: string) {
    const input = search()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function key(target: Element, k: string) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
  }

  it('shows the current workspace name as a closed menu button', async () => {
    const { load } = await render()
    expect(trigger().textContent).toBe('Capital Markets')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(listbox()).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('opens on click with every workspace, the current one marked and highlighted', async () => {
    const { load } = await render()
    await open()
    expect(load).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(search())
    expect(optionIds()).toEqual(['lib', 'port', 'back9', 'cap', 'prop'])
    const current = options().filter(o => o.getAttribute('aria-selected') === 'true')
    expect(current.map(o => o.dataset.workspaceId)).toEqual(['cap'])
    expect(current[0].getAttribute('aria-current')).toBe('page')
    expect(activeId()).toBe('cap')
    expect(options().find(o => o.dataset.workspaceId === 'back9')!.textContent).toContain('by Pat Doe')
  })

  it('navigates with arrows and Enter', async () => {
    const { onSelect } = await render()
    await open()
    await key(search(), 'ArrowDown')
    expect(activeId()).toBe('prop')
    await key(search(), 'ArrowDown') // wraps
    expect(activeId()).toBe('lib')
    await key(search(), 'ArrowUp')
    await key(search(), 'ArrowUp')
    expect(activeId()).toBe('cap')
    await key(search(), 'ArrowUp')
    await key(search(), 'Enter')
    expect(onSelect).toHaveBeenCalledWith('back9')
    expect(listbox()).toBeNull()
  })

  it('filters as you type and opens the first match on Enter', async () => {
    const { onSelect } = await render()
    await open()
    await type('port')
    expect(optionIds()).toEqual(['port'])
    await type('o')
    expect(optionIds()).toEqual(['port', 'prop'])
    await type('nothing like this')
    expect(options()).toEqual([])
    expect(listbox()!.textContent).toContain('No matching workspaces')
    await type('prop')
    await key(search(), 'Enter')
    expect(onSelect).toHaveBeenCalledWith('prop')
  })

  it('closes on Escape without navigating and returns focus', async () => {
    const { onSelect } = await render()
    await open()
    await key(search(), 'Escape')
    expect(listbox()).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger())
  })

  it('opens from the keyboard with ArrowDown on the button', async () => {
    await render()
    trigger().focus()
    await key(trigger(), 'ArrowDown')
    expect(listbox()).not.toBeNull()
  })

  it('navigates on click, and picking the current workspace only closes', async () => {
    const { onSelect } = await render()
    await open()
    await act(async () => options().find(o => o.dataset.workspaceId === 'cap')!.click())
    expect(onSelect).not.toHaveBeenCalled()
    expect(listbox()).toBeNull()
    await open()
    await act(async () => options().find(o => o.dataset.workspaceId === 'port')!.click())
    expect(onSelect).toHaveBeenCalledWith('port')
  })

  it('closes on an outside click', async () => {
    await render()
    await open()
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(listbox()).toBeNull()
  })

  it('lists the open workspace under its live title even when the account list omits it', async () => {
    await render({ currentId: 'shared', currentTitle: 'Renamed Shared' })
    await open()
    const current = options().find(o => o.dataset.workspaceId === 'shared')!
    expect(current.getAttribute('aria-selected')).toBe('true')
    expect(current.textContent).toContain('Renamed Shared')
    expect(trigger().textContent).toBe('Renamed Shared')
  })

  it('shows loading, then a failure message when the list cannot load', async () => {
    let reject!: (e: Error) => void
    await render({ load: () => new Promise((_, r) => { reject = r }) })
    await open()
    expect(listbox()!.textContent).toContain('Loading workspaces')
    await act(async () => reject(new Error('offline')))
    expect(listbox()!.textContent).toContain("Couldn't load workspaces")
  })
})
