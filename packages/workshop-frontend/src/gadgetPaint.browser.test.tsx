/* eslint-disable react/react-in-jsx-scope */

// The gadget pane keeps its loading cover up until the real sandboxed frame reports it drew
// something (the paint check in GadgetUI's injected prefix). A gadget that renders late, after its
// own data call, keeps the cover up until then; an empty body never lifts it early.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GadgetClient, UiBundle } from '@gadgets/workshop-shared/api'
import type { RpcStub } from 'capnweb'
import GadgetUI from './GadgetUI'

function gadgetWithUi(jsCode: string) {
  return {
    connectToGadget: async () => ({}),
    getUiBundle: async (): Promise<UiBundle> => ({ jsCode }),
  } as unknown as RpcStub<GadgetClient>
}

// Renders an empty root at once and its content 600 ms later.
const LATE_RENDER = `
const root = document.createElement('div');
root.id = 'root';
document.body.append(root);
setTimeout(() => { root.textContent = 'Rent roll'; }, 600);
`

describe('gadget paint cover', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('stays up until the gadget draws content, then lifts', async () => {
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetWithUi(LATE_RENDER)} height="300px" />)
    })
    const cover = () => container.querySelector('[role="status"]')
    await vi.waitFor(() => expect(container.querySelector('iframe')).not.toBeNull(), { timeout: 5000 })
    expect(cover()).not.toBeNull()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(cover()).not.toBeNull()
    await vi.waitFor(() => expect(cover()).toBeNull(), { timeout: 5000 })
  })
})
