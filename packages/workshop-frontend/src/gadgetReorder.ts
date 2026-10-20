import { useState, type DragEvent, type KeyboardEvent } from 'react'
import type { WorkpieceId } from '@gadgets/workshop-shared/api'

// Drag-and-drop and keyboard reordering of gadgets in the Outputs rail, which lists them within
// each category group in the workspace's saved order (GadgetMetadata.gadgetOrder); a move places
// one gadget before or after another, and the editor turns that into a new full order and saves it
// with Overseer.setGadgetOrder().

/** Which side of the target a moved gadget lands on. */
export type GadgetPlacement = 'before' | 'after'

/** One gadget moved next to another. */
export interface GadgetMove {
  id: WorkpieceId
  targetId: WorkpieceId
  placement: GadgetPlacement
}

/**
 * The full order after `move`, given the order now. Ids other than the moved one keep their
 * relative order; a move onto itself or onto an id not in `order` changes nothing.
 */
export function applyGadgetMove(order: readonly WorkpieceId[], move: GadgetMove): WorkpieceId[] {
  if (move.id === move.targetId || !order.includes(move.id) || !order.includes(move.targetId)) {
    return [...order]
  }
  const result = order.filter(id => id !== move.id)
  const at = result.indexOf(move.targetId) + (move.placement === 'after' ? 1 : 0)
  result.splice(at, 0, move.id)
  return result
}

const DRAG_TYPE = 'application/x-gadget-id'

/**
 * Per-item props for a reorderable list. `ids` are the reorderable items in display order (others,
 * such as worktrees, are left out and get no props). Without `onMove` nothing is draggable.
 * `axis` picks the drop-side test and the Alt+arrow keys: Left/Right for a row of tabs, Up/Down
 * for a vertical list.
 */
export function useGadgetReorder(
  ids: readonly WorkpieceId[],
  onMove: ((move: GadgetMove) => void) | undefined,
  axis: 'x' | 'y',
) {
  const [dragId, setDragId] = useState<WorkpieceId | null>(null)
  const [dropTarget, setDropTarget] =
    useState<{ id: WorkpieceId; placement: GadgetPlacement } | null>(null)

  const enabled = onMove !== undefined && ids.length > 1
  const [prevKey, nextKey] = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']

  const placementAt = (e: DragEvent<HTMLElement>): GadgetPlacement => {
    const rect = e.currentTarget.getBoundingClientRect()
    return axis === 'x'
      ? (e.clientX - rect.left > rect.width / 2 ? 'after' : 'before')
      : (e.clientY - rect.top > rect.height / 2 ? 'after' : 'before')
  }

  const reset = () => {
    setDragId(null)
    setDropTarget(null)
  }

  const itemProps = (id: WorkpieceId) => {
    if (!enabled || !ids.includes(id)) return {}
    return {
      draggable: true,
      'aria-keyshortcuts': axis === 'x' ? 'Alt+ArrowLeft Alt+ArrowRight' : 'Alt+ArrowUp Alt+ArrowDown',
      'aria-description': `Drag to reorder, or move with Alt plus the ${axis === 'x' ? 'left and right' : 'up and down'} arrow keys.`,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(DRAG_TYPE, String(id))
        setDragId(id)
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (dragId === null || !e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const placement = placementAt(e)
        if (dropTarget?.id !== id || dropTarget.placement !== placement) {
          setDropTarget({ id, placement })
        }
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDropTarget(current => (current?.id === id ? null : current))
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault()
        const moved = Number(e.dataTransfer.getData(DRAG_TYPE))
        const placement = placementAt(e)
        reset()
        if (Number.isInteger(moved) && moved !== id && ids.includes(moved)) {
          onMove!({ id: moved, targetId: id, placement })
        }
      },
      onDragEnd: reset,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (!e.altKey || (e.key !== prevKey && e.key !== nextKey)) return
        const index = ids.indexOf(id)
        const neighbor = ids[e.key === prevKey ? index - 1 : index + 1]
        if (neighbor === undefined) return
        e.preventDefault()
        onMove!({ id, targetId: neighbor, placement: e.key === prevKey ? 'before' : 'after' })
      },
    }
  }

  // Inset bar on the side the dragged item would land, drawn without changing the item's size.
  const dropIndicatorStyle = (id: WorkpieceId) => {
    if (dropTarget?.id !== id || dragId === id) return undefined
    const bar = 'var(--color-kumo-brand)'
    const shadow = axis === 'x'
      ? (dropTarget.placement === 'before' ? `inset 2px 0 0 0 ${bar}` : `inset -2px 0 0 0 ${bar}`)
      : (dropTarget.placement === 'before' ? `inset 0 2px 0 0 ${bar}` : `inset 0 -2px 0 0 ${bar}`)
    return { boxShadow: shadow }
  }

  return { itemProps, dropIndicatorStyle, draggingId: dragId }
}
