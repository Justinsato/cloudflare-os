// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkpieceSummary } from '@gadgets/workshop-shared/api'
import GadgetSwitcher from './GadgetSwitcher'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./components/format/FormatVisuals', () => ({ FormatGlyph: () => null }))

// In the workspace's saved order.
const WORKPIECES: WorkpieceSummary[] = [
  { id: 1, type: 'gadget', title: 'Report · Test · Tidewater Covenants · Monthly' },
  { id: 2, type: 'gadget', title: 'Receipts Hold' },
  { id: 3, type: 'gadget', title: 'Dashboard · Monitor · Debt Maturities · Daily' },
  { id: 4, type: 'gadget', title: 'Report · Test · Bridge Covenants · Monthly' },
  { id: 5, type: 'gadget', title: 'Feed · Ingest · Lender Mail · Live' },
  { id: 6, type: 'worktree', title: 'scratch branch', chatId: 2 } as WorkpieceSummary,
]

describe('GadgetSwitcher', () => {
  let root: Root | undefined
  let container: HTMLElement

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
  })

  async function render(selectedId = 3, onSelect = vi.fn<(id: number) => void>()) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <GadgetSwitcher workpieces={WORKPIECES} selectedId={selectedId} onSelect={onSelect} />,
    ))
    return onSelect
  }

  const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
  const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')
  const search = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!
  const groupNames = () =>
    [...document.querySelectorAll('[role="group"]')].map(g =>
      document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent)
  const optionTitles = () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(o => o.title)

  async function type(value: string) {
    const input = search()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function key(target: Element, k: string, init: KeyboardEventInit = {}) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
    })
  }

  it('shows the selected output as Contents with its category, action and cadence', async () => {
    await render()
    expect(trigger().textContent).toContain('Debt Maturities')
    expect(trigger().textContent).toContain('Dashboard · Monitor · Daily')
    expect(trigger().title).toBe('Dashboard · Monitor · Debt Maturities · Daily')
    expect(listbox()).toBeNull()
  })

  it('opens on click, grouped by category in order, saved order kept within a group', async () => {
    await render()
    await act(async () => trigger().click())
    expect(listbox()).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(groupNames()).toEqual(['Dashboard', 'Report', 'Feed', 'Other'])
    expect(optionTitles()).toEqual([
      'Dashboard · Monitor · Debt Maturities · Daily',
      'Report · Test · Tidewater Covenants · Monthly',
      'Report · Test · Bridge Covenants · Monthly',
      'Feed · Ingest · Lender Mail · Live',
      'Receipts Hold',
      'scratch branch',
    ])
    const selected = document.querySelector('[role="option"][aria-selected="true"]') as HTMLElement
    expect(selected.title).toBe('Dashboard · Monitor · Debt Maturities · Daily')
    // Contents leads; the rest is the secondary line.
    expect(selected.textContent).toContain('Debt Maturities')
    expect(selected.textContent).toContain('Monitor · Daily')
  })

  it('filters on the full title', async () => {
    await render()
    await act(async () => trigger().click())
    await type('monthly')
    expect(optionTitles()).toEqual([
      'Report · Test · Tidewater Covenants · Monthly',
      'Report · Test · Bridge Covenants · Monthly',
    ])
    expect(groupNames()).toEqual(['Report'])
    await type('nothing like this')
    expect(optionTitles()).toEqual([])
    expect(listbox()!.textContent).toContain('No matching outputs')
  })

  it('selects with arrow keys and Enter, then closes', async () => {
    const onSelect = await render()
    await act(async () => trigger().click())
    // Starts on the selected output (Debt Maturities, first); two down is Bridge Covenants.
    await key(search(), 'ArrowDown')
    await key(search(), 'ArrowDown')
    const activeId = search().getAttribute('aria-activedescendant')!
    expect(document.getElementById(activeId)!.title).toBe('Report · Test · Bridge Covenants · Monthly')
    await key(search(), 'Enter')
    expect(onSelect).toHaveBeenCalledWith(4)
    expect(listbox()).toBeNull()
  })

  it('selects the first match after searching', async () => {
    const onSelect = await render()
    await act(async () => trigger().click())
    await type('scratch')
    await key(search(), 'Enter')
    expect(onSelect).toHaveBeenCalledWith(6)
  })

  it('closes on Escape without selecting', async () => {
    const onSelect = await render()
    await act(async () => trigger().click())
    await key(search(), 'Escape')
    expect(listbox()).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger())
  })

  it('opens with Cmd+K and Ctrl+K', async () => {
    await render()
    await key(document.body, 'k', { metaKey: true })
    expect(listbox()).not.toBeNull()
    expect(document.activeElement).toBe(search())
    await key(document.body, 'k', { metaKey: true })
    expect(listbox()).toBeNull()
    await key(document.body, 'K', { ctrlKey: true })
    expect(listbox()).not.toBeNull()
  })

  it('selects on click', async () => {
    const onSelect = await render()
    await act(async () => trigger().click())
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(o => o.title === 'Receipts Hold')!
    await act(async () => option.click())
    expect(onSelect).toHaveBeenCalledWith(2)
  })
})
