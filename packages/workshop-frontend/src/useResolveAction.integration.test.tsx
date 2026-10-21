// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RpcSession, RpcTarget, type RpcStub, type RpcTransport } from 'capnweb'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionLogEntry, Overseer } from '@gadgets/workshop-shared/api'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) {
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  } else {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  }
})

const addToast = vi.hoisted(() => vi.fn<(options: { title: string, description?: string }) => void>())

vi.mock('@cloudflare/kumo', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@cloudflare/kumo')
  const toasts = { add: addToast }
  return { ...actual, useKumoToastManager: () => toasts }
})

import {
  RESOLVE_RECONNECT_WAIT_MS, RESOLVE_RESPONSE_TIMEOUT_MS, useResolveAction,
} from './useResolveAction'

// One direction of a browser WebSocket, as capnweb's WebSocketTransport sees it. `closing` is
// the CLOSING state: send() drops the message without throwing (the browser only logs "WebSocket
// is already in CLOSING or CLOSED state"), and nothing reaches capnweb until the close event.
class SocketEnd implements RpcTransport {
  peer!: SocketEnd
  closing = false
  private queue: string[] = []
  private waiting: Array<{ resolve: (message: string) => void, reject: (error: unknown) => void }> = []
  private closed: unknown

  async send(message: string) {
    if (this.closing || this.closed) return
    this.peer.deliver(message)
  }

  receive(): Promise<string> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!)
    if (this.closed) return Promise.reject(this.closed)
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }))
  }

  /** The close event: what capnweb hears once the dying socket finally reports in. */
  close(code = 1006) {
    this.closed = new Error(`Peer closed WebSocket: ${code} `)
    for (const waiter of this.waiting.splice(0)) waiter.reject(this.closed)
  }

  private deliver(message: string) {
    const waiter = this.waiting.shift()
    if (waiter) waiter.resolve(message)
    else this.queue.push(message)
  }
}

/** The workspace's action table, shared by every connection, as the Durable Object's storage is. */
class Workspace {
  states = new Map<number, 'pending' | 'approved' | 'rejected'>()
  applied: number[] = []
}

class OverseerTarget extends RpcTarget {
  constructor(private workspace: Workspace, private hold?: Promise<void>) {
    super()
  }

  async approveAction(id: number) {
    await this.hold
    if (this.workspace.states.get(id) !== 'pending') throw new Error(`Action is not pending: ${id}`)
    this.workspace.states.set(id, 'approved')
    this.workspace.applied.push(id)
  }

  async rejectAction(id: number) {
    await this.hold
    if (this.workspace.states.get(id) !== 'pending') throw new Error(`Action is not pending: ${id}`)
    this.workspace.states.set(id, 'rejected')
  }
}

function connect(workspace: Workspace, hold?: Promise<void>) {
  const client = new SocketEnd()
  const server = new SocketEnd()
  client.peer = server
  server.peer = client
  const serverSession = new RpcSession(server, new OverseerTarget(workspace, hold))
  const overseer = new RpcSession<Overseer>(client).getRemoteMain() as unknown as RpcStub<Overseer>
  return { overseer, client, server, serverSession }
}

function pendingAction(id: number): ActionLogEntry {
  return { id, type: 'action', state: 'pending' } as unknown as ActionLogEntry
}

type Harness = {
  resolveAction: ReturnType<typeof useResolveAction>['resolveAction']
  processing: Set<number>
  setOverseer: (overseer: RpcStub<Overseer>) => void
}

describe('useResolveAction across a dropped connection', () => {
  let container: HTMLDivElement
  let root: Root
  let harness: Harness
  const resolved: Array<[number, string]> = []

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    addToast.mockClear()
    resolved.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await act(async () => root.unmount())
    container.remove()
  })

  async function mount(initial: RpcStub<Overseer>) {
    function Probe() {
      // Wrapped, as RpcContext does: a stub is callable, so React would run a bare one as an updater.
      const [overseer, setOverseer] = useState({ stub: initial })
      const [processing, setProcessing] = useState(new Set<number>())
      const { resolveAction } = useResolveAction(overseer.stub, setProcessing, (id, state) => {
        resolved.push([id, state])
      })
      harness = { resolveAction, processing, setOverseer: stub => setOverseer({ stub }) }
      return null
    }
    await act(async () => root.render(<Probe />))
  }

  it('retries an approve sent into a CLOSING socket on the restored overseer', async () => {
    const workspace = new Workspace()
    workspace.states.set(7, 'pending')
    const first = connect(workspace)
    await mount(first.overseer)

    first.client.closing = true
    let decision!: Promise<void>
    await act(async () => { decision = harness.resolveAction(pendingAction(7), 'approve') })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(workspace.applied).toEqual([])
    expect(harness.processing.has(7)).toBe(true)

    // The close arrives, then the connection manager publishes the restored session.
    await act(async () => { first.client.close() })
    const restored = connect(workspace)
    await act(async () => { harness.setOverseer(restored.overseer) })
    await act(async () => { await decision })

    expect(workspace.applied).toEqual([7])
    expect(resolved).toEqual([[7, 'approved']])
    expect(addToast).not.toHaveBeenCalled()
    expect(harness.processing.has(7)).toBe(false)
  })

  it('retries a deny issued on a session that already closed', async () => {
    const workspace = new Workspace()
    workspace.states.set(3, 'pending')
    const first = connect(workspace)
    await mount(first.overseer)
    await act(async () => { first.client.close() })

    let decision!: Promise<void>
    await act(async () => { decision = harness.resolveAction(pendingAction(3), 'deny') })
    const restored = connect(workspace)
    await act(async () => { harness.setOverseer(restored.overseer) })
    await act(async () => { await decision })

    expect(workspace.states.get(3)).toBe('rejected')
    expect(resolved).toEqual([[3, 'rejected']])
    expect(addToast).not.toHaveBeenCalled()
  })

  it('treats "not pending" on the retry as the first attempt having landed', async () => {
    const workspace = new Workspace()
    workspace.states.set(9, 'pending')
    const first = connect(workspace)
    await mount(first.overseer)

    // The request reaches the server, but its answer is lost with the socket.
    first.server.closing = true
    let decision!: Promise<void>
    await act(async () => { decision = harness.resolveAction(pendingAction(9), 'approve') })
    await vi.waitFor(() => expect(workspace.applied).toEqual([9]))
    await act(async () => { first.client.close() })
    const restored = connect(workspace)
    await act(async () => { harness.setOverseer(restored.overseer) })
    await act(async () => { await decision })

    expect(workspace.applied).toEqual([9])
    expect(addToast).not.toHaveBeenCalled()
    // Its real state reaches the card through the actions subscription, not optimistically.
    expect(resolved).toEqual([])
    expect(harness.processing.has(9)).toBe(false)
  })

  it('shows the error when no restored session arrives', async () => {
    const workspace = new Workspace()
    workspace.states.set(4, 'pending')
    const first = connect(workspace)
    await mount(first.overseer)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    first.client.closing = true
    let decision!: Promise<void>
    await act(async () => { decision = harness.resolveAction(pendingAction(4), 'approve') })
    await act(async () => { first.client.close() })
    await act(async () => { await vi.advanceTimersByTimeAsync(RESOLVE_RECONNECT_WAIT_MS) })
    await act(async () => { await decision })

    expect(workspace.applied).toEqual([])
    expect(addToast).toHaveBeenCalledOnce()
    expect(addToast.mock.calls[0][0]).toMatchObject({ title: 'Failed to approve action' })
    expect(harness.processing.has(4)).toBe(false)
  })

  it('tells the user when a live session never answers', async () => {
    const workspace = new Workspace()
    workspace.states.set(5, 'pending')
    const first = connect(workspace, new Promise(() => {}))
    await mount(first.overseer)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    let decision!: Promise<void>
    await act(async () => { decision = harness.resolveAction(pendingAction(5), 'approve') })
    await act(async () => { await vi.advanceTimersByTimeAsync(RESOLVE_RESPONSE_TIMEOUT_MS) })
    await act(async () => { await decision })

    expect(addToast).toHaveBeenCalledOnce()
    expect(addToast.mock.calls[0][0]).toMatchObject({ title: 'No answer yet to approve action' })
    expect(harness.processing.has(5)).toBe(false)
  })
})
