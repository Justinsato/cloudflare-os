import { MAX_GADGET_VIEW_STATE_LENGTH } from './GadgetUI'

// The workspace URL's `view` search param carries the selected gadget's view state (see
// `gadgetView` in GadgetUI's injected prefix) as `<gadgetId>:<query>`. The id prefix keeps a value
// left over from one gadget from reaching another: selecting a different gadget keeps `view`
// (navigations spread the previous search), but the new gadget reads nothing until it saves its own.

/** The view state `param` holds for `gadgetId`, or undefined if it holds another gadget's. */
export function gadgetViewStateFromParam(param: unknown, gadgetId: number | null): string | undefined {
  if (typeof param !== 'string' || gadgetId === null) return undefined
  const separator = param.indexOf(':')
  if (separator < 0 || param.slice(0, separator) !== String(gadgetId)) return undefined
  const state = param.slice(separator + 1)
  return state.length <= MAX_GADGET_VIEW_STATE_LENGTH ? state : undefined
}

/** The `view` param value saving `state` for `gadgetId`; undefined (drop the param) when empty. */
export function gadgetViewParam(gadgetId: number, state: string): string | undefined {
  return state === '' ? undefined : `${gadgetId}:${state}`
}
