/* eslint-disable react/react-in-jsx-scope */

// A gadget's sandboxed frame can't navigate the workspace, so links to other gadgets are turned
// into open-workpiece requests by the injected prefix. This runs the real frame in Chromium.

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

// Clicks every link the gadget renders, one after another.
const CLICK_ALL = (html: string) => `
document.body.innerHTML = ${JSON.stringify(html)};
for (const el of document.querySelectorAll('[data-click]')) el.click();
`

describe('links between gadgets', () => {
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

  it('opens the target gadget for each supported link form, and leaves other links alone', async () => {
    const open = vi.fn<(target: { id?: number; title?: string; view?: string }) => void>()
    const html = [
      '<a data-click href="https://mofohub.com/workspace/abc123?w=7">url</a>',
      '<a data-click href="#w=8">hash</a>',
      '<button data-click data-workpiece-id="9">id</button>',
      '<div data-click data-workpiece-title="Tracker · Hold · Materials Receipts · Live">title</div>',
      '<a data-click href="https://example.com/?w=10" target="_blank">external</a>',
    ].join('')
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetWithUi(CLICK_ALL(html))} height="200px" onOpenWorkpiece={open} />)
    })
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(4), { timeout: 5000 })
    expect(open.mock.calls.map(c => c[0])).toEqual([
      { id: 7, title: undefined, view: undefined },
      { id: 8, title: undefined, view: undefined },
      { id: 9, title: undefined, view: undefined },
      { id: undefined, title: 'Tracker · Hold · Materials Receipts · Live', view: undefined },
    ])
  })
  it('carries the view state a link names to the gadget it opens', async () => {
    const open = vi.fn<(target: { id?: number; title?: string; view?: string }) => void>()
    const html = [
      '<button data-click data-workpiece-id="51" data-workpiece-view="wo=83196-1">attr</button>',
      '<a data-click href="#w=20&wo=83196-1&sort=billed">hash</a>',
      '<a data-click href="https://os.lfiq.app/workspace/abc123?w=18&view=18%3Awo%3D1-1">url</a>',
      '<a data-click href="https://os.lfiq.app/workspace/abc123?w=18&view=7%3Awo%3D1-1">other gadget view</a>',
    ].join('')
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetWithUi(CLICK_ALL(html))} height="200px" onOpenWorkpiece={open} />)
    })
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(4), { timeout: 5000 })
    expect(open.mock.calls.map(c => c[0])).toEqual([
      { id: 51, title: undefined, view: 'wo=83196-1' },
      { id: 20, title: undefined, view: 'wo=83196-1&sort=billed' },
      { id: 18, title: undefined, view: 'wo=1-1' },
      { id: 18, title: undefined, view: undefined },
    ])
  })
})
