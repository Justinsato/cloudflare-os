import { describe, expect, it } from 'vitest'
import { MAX_GADGET_VIEW_STATE_LENGTH } from './GadgetUI'
import { gadgetViewParam, gadgetViewStateFromParam } from './gadgetViewParam'

describe('gadget view param', () => {
  it("round-trips a gadget's view state", () => {
    const param = gadgetViewParam(29, 'sort=title&dir=desc&f.title=lease')
    expect(param).toBe('29:sort=title&dir=desc&f.title=lease')
    expect(gadgetViewStateFromParam(param, 29)).toBe('sort=title&dir=desc&f.title=lease')
  })

  it("withholds another gadget's view state", () => {
    expect(gadgetViewStateFromParam('29:sort=title', 30)).toBeUndefined()
    expect(gadgetViewStateFromParam('29:sort=title', null)).toBeUndefined()
    expect(gadgetViewStateFromParam('2:sort=title', 29)).toBeUndefined()
  })

  it('ignores malformed and oversized values', () => {
    expect(gadgetViewStateFromParam('sort=title', 29)).toBeUndefined()
    expect(gadgetViewStateFromParam(29, 29)).toBeUndefined()
    expect(gadgetViewStateFromParam(`29:${'a'.repeat(MAX_GADGET_VIEW_STATE_LENGTH + 1)}`, 29))
      .toBeUndefined()
  })

  it('drops the param when the state is cleared', () => {
    expect(gadgetViewParam(29, '')).toBeUndefined()
  })
})
