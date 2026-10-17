import type { WorkpieceId } from "./api.js";

/**
 * Sort `items` by a workspace's saved gadget order (see GadgetMetadata.gadgetOrder). Items named
 * in `order` come first, in that order; items it doesn't name (gadgets created after the order was
 * last saved, drafts) follow in id order, which is creation order. Ids in `order` with no matching
 * item (deleted gadgets) are ignored. Returns a new array.
 */
export function sortByGadgetOrder<T extends {id: WorkpieceId}>(
    items: Iterable<T>, order: readonly WorkpieceId[] | undefined): T[] {
  let rank = new Map<WorkpieceId, number>();
  order?.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index); });
  return [...items].toSorted((a, b) => {
    let ra = rank.get(a.id);
    let rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.id - b.id;
  });
}

/**
 * Normalize a requested gadget order against the ids that exist: duplicates and unknown ids are
 * dropped, and existing ids the request leaves out are appended in id order. The result names
 * every id in `existing` exactly once.
 */
export function normalizeGadgetOrder(
    requested: readonly WorkpieceId[], existing: Iterable<WorkpieceId>): WorkpieceId[] {
  let known = new Set(existing);
  let seen = new Set<WorkpieceId>();
  let result: WorkpieceId[] = [];
  for (let id of requested) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  for (let id of [...known].toSorted((a, b) => a - b)) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

/**
 * Move the item at `from` to `to` (an index in the list after removal, as from a drag-and-drop
 * insertion point). Returns a new array; out-of-range indexes are clamped.
 */
export function moveGadget<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  let result = [...items];
  let [moved] = result.splice(from, 1);
  result.splice(Math.max(0, Math.min(to, result.length)), 0, moved!);
  return result;
}
