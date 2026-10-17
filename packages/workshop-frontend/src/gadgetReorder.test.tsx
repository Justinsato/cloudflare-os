// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GadgetSummary } from '@gadgets/workshop-shared/api'
import { sortByGadgetOrder } from '@gadgets/workshop-shared/gadget-order'
import { applyGadgetMove, type GadgetMove } from './gadgetReorder'
import WorkpiecePicker from './WorkpiecePicker'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const GADGETS: GadgetSummary[] = [
  { id: 1, type: 'gadget', title: 'Dashboard' },
  { id: 2, type: 'gadget', title: 'Insights' },
  { id: 3, type: 'gadget', title: 'Receipts Hold' },
]

describe('sortByGadgetOrder (frontend list order)', () => {
  it('follows the saved order, then id order for gadgets it does not name', () => {
    const extra: GadgetSummary = { id: 4, type: 'gadget', title: 'New' }
    const sorted = sortByGadgetOrder([...GADGETS, extra], [3, 1])
    expect(sorted.map(g => g.title)).toEqual(['Receipts Hold', 'Dashboard', 'Insights', 'New'])
  })

  it('falls back to id order with no saved order, ignoring deleted ids', () => {
    expect(sortByGadgetOrder(GADGETS.toReversed(), undefined).map(g => g.id)).toEqual([1, 2, 3])
    expect(sortByGadgetOrder(GADGETS, [9, 2]).map(g => g.id)).toEqual([2, 1, 3])
  })
})

describe('applyGadgetMove', () => {
  it('places the moved id before or after the target', () => {
    expect(applyGadgetMove([1, 2, 3], { id: 3, targetId: 1, placement: 'before' })).toEqual([3, 1, 2])
    expect(applyGadgetMove([1, 2, 3], { id: 1, targetId: 3, placement: 'after' })).toEqual([2, 3, 1])
    expect(applyGadgetMove([1, 2, 3], { id: 1, targetId: 2, placement: 'after' })).toEqual([2, 1, 3])
  })

  it('changes nothing for a self-move or unknown ids', () => {
    expect(applyGadgetMove([1, 2], { id: 1, targetId: 1, placement: 'after' })).toEqual([1, 2])
    expect(applyGadgetMove([1, 2], { id: 7, targetId: 1, placement: 'before' })).toEqual([1, 2])
  })
})

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[draggable="true"]')]

describe('Outputs rail reordering', () => {
  let root: Root | undefined
  afterEach(() => act(() => root?.unmount()))

  async function render(onMoveGadget?: (move: GadgetMove) => void) {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root!.render(
      <WorkpiecePicker
        gadgets={GADGETS}
        worktrees={[]}
        selectedId={null}
        expanded
        hookedGadgetIds={new Set()}
        onExpandedChange={vi.fn<(expanded: boolean) => void>()}
        onSelect={vi.fn<(id: number) => void>()}
        onRename={vi.fn<(id: number, title: string) => void>()}
        onMoveGadget={onMoveGadget}
        pendingActivityCount={0}
        onOpenActivity={vi.fn<() => void>()}
      />,
    ))
    return container
  }

  it('makes gadget rows draggable only when reordering is allowed', async () => {
    expect(rows(await render(vi.fn<(move: GadgetMove) => void>()))).toHaveLength(3)
    await act(async () => root!.unmount())
    expect(rows(await render(undefined))).toHaveLength(0)
  })

  it('moves with Alt+ArrowUp/Down', async () => {
    const onMove = vi.fn<(move: GadgetMove) => void>()
    const container = await render(onMove)
    const button = rows(container)[1]!.querySelector('button')!
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    })
    expect(onMove).toHaveBeenLastCalledWith({ id: 2, targetId: 1, placement: 'before' })
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))
    })
    expect(onMove).toHaveBeenLastCalledWith({ id: 2, targetId: 3, placement: 'after' })
    // Without Alt the arrows don't reorder; the first row has nothing above it.
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      rows(container)[0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    })
    expect(onMove).toHaveBeenCalledTimes(2)
  })

  it('drops a dragged row onto another', async () => {
    const onMove = vi.fn<(move: GadgetMove) => void>()
    const container = await render(onMove)
    const [first, , third] = rows(container)
    const data = new Map<string, string>()
    const dataTransfer = {
      get types() { return [...data.keys()] },
      setData: (type: string, value: string) => { data.set(type, value) },
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: 'none', dropEffect: 'none',
    }
    const fire = (el: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { dataTransfer, clientX: 0, clientY: 0 })
      el.dispatchEvent(event)
    }
    await act(async () => { fire(third!, 'dragstart') })
    await act(async () => { fire(first!, 'dragover') })
    await act(async () => { fire(first!, 'drop') })
    // jsdom lays nothing out, so the pointer is never past the row's midpoint: "before".
    expect(onMove).toHaveBeenCalledWith({ id: 3, targetId: 1, placement: 'before' })
  })
})
