// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

// GadgetUI hands the workspace's resolved light/dark mode to the gadget frame: baked into the
// srcdoc, set as the iframe's color-scheme, and posted to the frame on every change. The frame side
// is exercised in Chromium by gadgetTheme.browser.test.tsx.

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

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as typeof window.matchMedia

import GadgetUI from './GadgetUI'
import { ThemeProvider, useTheme } from './ThemeContext'
import type { ThemeMode } from './theme'

function gadgetWithUi(jsCode: string) {
  return {
    connectToGadget: async () => ({}),
    getUiBundle: async (): Promise<UiBundle> => ({ jsCode }),
  } as unknown as RpcStub<GadgetClient>
}

let setMode: ((mode: ThemeMode) => void) | null = null
function ModeHandle() {
  setMode = useTheme().setThemeMode
  return null
}

describe('GadgetUI theme', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.setItem('gadgets:theme-mode', 'dark')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    setMode = null
  })

  async function renderFrame() {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ModeHandle />
          <GadgetUI gadget={gadgetWithUi('void 0')} height="200px" />
        </ThemeProvider>,
      )
    })
    const frame = await vi.waitFor(() => {
      const found = container.querySelector('iframe')
      if (!found) throw new Error('no frame yet')
      return found
    })
    return frame
  }

  it('opens the frame in the workspace mode', async () => {
    const frame = await renderFrame()
    expect(frame.style.colorScheme).toBe('dark')
    const srcdoc = frame.getAttribute('srcdoc')!
    expect(srcdoc).toContain('<html data-theme="dark" style="color-scheme: dark">')
    expect(decodeURIComponent(srcdoc)).toContain('const __gadgetTheme = "dark";')
  })

  it('sets color-scheme and posts each change to the frame without reloading it', async () => {
    const frame = await renderFrame()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    const srcdoc = frame.getAttribute('srcdoc')

    await act(async () => setMode!('light'))
    expect(frame.style.colorScheme).toBe('light')
    expect(post).toHaveBeenLastCalledWith({ type: 'theme', theme: 'light' }, '*')

    await act(async () => setMode!('dark'))
    expect(frame.style.colorScheme).toBe('dark')
    expect(post).toHaveBeenLastCalledWith({ type: 'theme', theme: 'dark' }, '*')

    // Same frame, same document: a flip never rebuilds the srcdoc.
    expect(container.querySelector('iframe')).toBe(frame)
    expect(frame.getAttribute('srcdoc')).toBe(srcdoc)

    // Re-selecting the current mode posts nothing new.
    post.mockClear()
    await act(async () => setMode!('dark'))
    expect(post).not.toHaveBeenCalled()
  })

  it('re-sends the theme when the frame handshakes', async () => {
    const frame = await renderFrame()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    const { port2 } = new MessageChannel()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: 'handshake',
        origin: 'null',
        source: frame.contentWindow,
        ports: [port2],
      }))
    })
    expect(post).toHaveBeenCalledWith({ type: 'theme', theme: 'dark' }, '*')
    port2.close()
  })
})
