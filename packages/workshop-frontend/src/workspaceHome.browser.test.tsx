/* eslint-disable react/react-in-jsx-scope */

// The canonical Workspace Home (workshop-shared's workspace-home.ts, the snippet the agent's system
// prompt hands to every workspace agent) run in a real gadget frame in Chromium: rows come from the
// gadget's live list, the URL's view state sorts and filters them, header clicks and filter input
// save new view state, and a row click opens its gadget.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleLogEvent, GadgetClient, UiBundle } from '@gadgets/workshop-shared/api'
import { WORKSPACE_HOME_CLIENT_JS } from '@gadgets/workshop-shared/workspace-home'
import type { RpcStub } from 'capnweb'
import GadgetUI from './GadgetUI'

const GADGETS = [
  { id: 30, title: 'Tracker · Hold · Materials Receipts · Live' },
  { id: 12, title: 'Dashboard · Review · Portfolio · Weekly' },
  { id: 7, title: 'Library · Browse · Lease Abstracts · Live' },
]

// The snippet, then a probe in the same module scope: it reports the rendered row ids and header
// labels through console.log (which the frame forwards), and performs `actions` in order.
function homeWithProbe(actions: string) {
  return `${WORKSPACE_HOME_CLIENT_JS}
const report = () => console.log(JSON.stringify({
  rows: [...body.rows].map(r => Number(r.dataset.workpieceId)),
  labels: [...labels.cells].map(c => c.textContent),
}));
report();
${actions}
`
}

function gadgetServing(jsCode: string) {
  const server = { listGadgets: async () => GADGETS }
  return {
    connectToGadget: async () => server,
    getUiBundle: async (): Promise<UiBundle> => ({ jsCode }),
  } as unknown as RpcStub<GadgetClient>
}

describe('Workspace Home snippet', () => {
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

  async function run(actions: string, viewState?: string) {
    const reports: { rows: number[], labels: string[] }[] = []
    const onConsoleLog = (log: ConsoleLogEvent) => {
      if (log.level === 'log') reports.push(JSON.parse(log.message[0]!))
    }
    const open = vi.fn<(target: { id?: number; title?: string }) => void>()
    const saved = vi.fn<(state: string) => void>()
    await act(async () => {
      root.render(<GadgetUI gadget={gadgetServing(homeWithProbe(actions))} height="300px"
        viewState={viewState} onViewStateChange={saved} onOpenWorkpiece={open}
        onConsoleLog={onConsoleLog} />)
    })
    return { reports, open, saved }
  }

  it('renders every gadget from the live list, sorted by title by default', async () => {
    const { reports } = await run('')
    await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 5000 })
    expect(reports[0]).toEqual({ rows: [12, 7, 30], labels: ['Gadget ▲', 'ID'] })
  })

  it('restores sort and filters from the URL view state', async () => {
    const { reports } = await run('', 'sort=id&dir=desc&f.title=e')
    await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 5000 })
    // "e" matches all three titles; the ID filter is empty. Sorted by id, descending.
    expect(reports[0]).toEqual({ rows: [30, 12, 7], labels: ['Gadget', 'ID ▼'] })
  })

  it('saves header sorts and filter input as view state', async () => {
    const { reports, saved } = await run(`
labels.cells[1].click(); report();
labels.cells[1].click(); report();
const filter = filters.cells[0].querySelector('input');
filter.value = 'live'; filter.dispatchEvent(new Event('input')); report();
`)
    await vi.waitFor(() => expect(reports).toHaveLength(4), { timeout: 5000 })
    expect(reports.slice(1).map(r => r.rows)).toEqual([[7, 12, 30], [30, 12, 7], [30, 7]])
    expect(saved.mock.calls.map(c => c[0])).toEqual([
      'sort=id&dir=asc',
      'sort=id&dir=desc',
      'sort=id&dir=desc&f.title=live',
    ])
  })

  it('opens the clicked row\'s gadget by id', async () => {
    const { open } = await run('body.rows[1].cells[0].click();')
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(open).toHaveBeenCalledWith({ id: 7, title: undefined })
  })
})
