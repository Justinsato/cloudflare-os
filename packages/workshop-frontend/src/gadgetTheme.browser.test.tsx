/* eslint-disable react/react-in-jsx-scope */

// The workspace has one light/dark switch and every gadget frame follows it. This runs the real
// sandboxed frame in Chromium and reads the theme from inside it: the data-theme / color-scheme /
// window.gadgetTheme the injected prefix keeps in step with the parent's posts, and what
// prefers-color-scheme reports.
//
// GadgetUI also sets color-scheme on the iframe element. Per CSS Color Adjust the embedded
// document's prefers-color-scheme should follow it, but Chromium (checked on 156, sandboxed and
// same-origin srcdoc frames alike) does not: inside the frame the media query keeps reporting the
// OS preference. So data-theme is what gadgets must style against. The last assertion pins that
// behavior; if it starts failing, Chromium has implemented the spec and the media query follows
// the switch too.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleLogEvent, GadgetClient, UiBundle } from '@gadgets/workshop-shared/api'
import type { RpcStub } from 'capnweb'
import GadgetUI from './GadgetUI'
import { ThemeProvider, useTheme } from './ThemeContext'
import type { ThemeMode } from './theme'

function gadgetWithUi(jsCode: string) {
  return {
    connectToGadget: async () => ({}),
    getUiBundle: async (): Promise<UiBundle> => ({ jsCode }),
  } as unknown as RpcStub<GadgetClient>
}

// Reports what the frame sees, at load and on every change, through the console bridge.
const REPORT_THEME = `
const mq = matchMedia('(prefers-color-scheme: dark)');
let events = 0;
const report = (why) => console.log(JSON.stringify({
  why,
  prefersDark: mq.matches,
  dataTheme: document.documentElement.dataset.theme,
  colorScheme: document.documentElement.style.colorScheme,
  gadgetTheme: window.gadgetTheme,
  events,
}));
mq.addEventListener('change', () => report('media'));
window.addEventListener('gadget-theme', (e) => { events++; report('event:' + e.detail.theme); });
try { window.gadgetTheme = 'bogus'; } catch {}
report('load');
`

interface Snapshot {
  why: string
  prefersDark: boolean
  dataTheme: string
  colorScheme: string
  gadgetTheme: string
  events: number
}

let setMode: ((mode: ThemeMode) => void) | null = null
function ModeHandle() {
  setMode = useTheme().setThemeMode
  return null
}

describe('gadget frames follow the workspace theme', () => {
  let container: HTMLDivElement
  let root: Root
  let logs: Snapshot[]

  beforeEach(() => {
    localStorage.setItem('gadgets:theme-mode', 'dark')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    logs = []
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.removeItem('gadgets:theme-mode')
    setMode = null
  })

  const latest = () => logs[logs.length - 1]

  it('starts in the workspace mode and flips live, without a reload', async () => {
    // Headless Chromium's own preference is light; the workspace is set to dark.
    const osPrefersDark = matchMedia('(prefers-color-scheme: dark)').matches
    expect(osPrefersDark).toBe(false)
    const onConsoleLog = (log: ConsoleLogEvent) => {
      for (const line of log.message) logs.push(JSON.parse(line) as Snapshot)
    }
    await act(async () => {
      root.render(
        <ThemeProvider>
          <ModeHandle />
          <GadgetUI gadget={gadgetWithUi(REPORT_THEME)} height="200px" onConsoleLog={onConsoleLog} />
        </ThemeProvider>,
      )
    })
    await vi.waitFor(() => expect(logs.some(l => l.why === 'load')).toBe(true), { timeout: 5000 })
    expect(logs.find(l => l.why === 'load')).toMatchObject({
      dataTheme: 'dark',
      colorScheme: 'dark',
      gadgetTheme: 'dark',
    })
    const frame = container.querySelector('iframe')!
    expect(frame.style.colorScheme).toBe('dark')

    await act(async () => setMode!('light'))
    expect(frame.style.colorScheme).toBe('light')
    await vi.waitFor(() => {
      expect(latest()).toMatchObject({ why: 'event:light', dataTheme: 'light', colorScheme: 'light', gadgetTheme: 'light', events: 1 })
    }, { timeout: 5000 })

    await act(async () => setMode!('dark'))
    expect(frame.style.colorScheme).toBe('dark')
    await vi.waitFor(() => {
      expect(latest()).toMatchObject({ why: 'event:dark', dataTheme: 'dark', colorScheme: 'dark', gadgetTheme: 'dark', events: 2 })
    }, { timeout: 5000 })

    // Same frame throughout: the flips were posted, not a reload.
    expect(container.querySelector('iframe')).toBe(frame)
    expect(logs.filter(l => l.why === 'load')).toHaveLength(1)

    // Chromium does not derive the frame's prefers-color-scheme from the iframe's color-scheme.
    expect(logs.every(l => l.prefersDark === osPrefersDark)).toBe(true)
    expect(logs.some(l => l.why === 'media')).toBe(false)
  })
})
