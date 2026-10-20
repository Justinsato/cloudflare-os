// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

// The gadget pane never sits blank: a loading cover shows while the UI bundle loads and then over
// the frame until the frame reports it painted (see the paint check in GadgetUI's injected prefix),
// or until a timeout for frames that never report.

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GadgetClient, UiBundle } from '@gadgets/workshop-shared/api'
import type { RpcStub } from 'capnweb'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

vi.mock('@cloudflare/kumo', () => ({
  Banner: () => null,
  Loader: () => null,
  Text: ({ children }: { children: ReactNode }) => children,
}))

import GadgetUI from './GadgetUI'

function gadgetWithUi(bundle: Promise<UiBundle | null>) {
  return {
    connectToGadget: async () => ({}),
    getUiBundle: () => bundle,
  } as unknown as RpcStub<GadgetClient>
}

describe('GadgetUI loading cover', () => {
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
    vi.useRealTimers()
  })

  const cover = () => container.querySelector('[role="status"]')

  it('shows the loader, not the no-UI placeholder, before the bundle replies', async () => {
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetWithUi(new Promise(() => {}))} height="200px" />)
    })
    expect(cover()?.textContent).toBe('Loading view…')
    expect(container.textContent).not.toContain('No gadget UI yet')
  })

  it('covers the frame until the frame reports it painted', async () => {
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetWithUi(Promise.resolve({ jsCode: 'void 0' }))} height="200px" />)
    })
    const frame = container.querySelector('iframe')!
    expect(frame).not.toBeNull()
    expect(cover()).not.toBeNull()

    // A message from any other window is ignored.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'painted' }, origin: 'null', source: window }))
    })
    expect(cover()).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'painted' }, origin: 'null', source: frame.contentWindow,
      }))
    })
    expect(cover()).toBeNull()
    expect(container.querySelector('iframe')).toBe(frame)
  })

  it('lifts the cover after a timeout when the frame never reports', async () => {
    vi.useFakeTimers()
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetWithUi(Promise.resolve({ jsCode: 'void 0' }))} height="200px" />)
    })
    expect(cover()).not.toBeNull()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(cover()).toBeNull()
  })
})
