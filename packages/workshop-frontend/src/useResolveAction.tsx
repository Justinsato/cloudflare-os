import {
  useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction,
} from 'react'
import { useKumoToastManager } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type {
  ActionLogEntry, ActionState, CreationApproval, Overseer,
} from '@gadgets/workshop-shared/api'
import { CreationAccountModal } from './components/CreationAccountModal'
import { classifyRpcError } from './rpcErrors'

type ActionDecision = 'approve' | 'deny'

/**
 * How long one approve/deny attempt may go unanswered before the user hears about it. Generous,
 * because applying an action can call out to a slow service; the call keeps running past it.
 */
export const RESOLVE_RESPONSE_TIMEOUT_MS = 60000
/** How long a decision interrupted by a dropped connection waits for the restored overseer. */
export const RESOLVE_RECONNECT_WAIT_MS = 30000

const NOT_PENDING_MESSAGE = 'Action is not pending'

class ConnectionDropped extends Error {
  constructor(readonly cause: unknown) {
    super('The connection dropped before the server answered.')
  }
}

class NoResponse extends Error {
  constructor() {
    super('The card updates if it went through. Otherwise, try again.')
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Runs one decision RPC against `stub`, settling it however the connection under it behaves.
 * A socket that is CLOSING drops sends without an error, and the session only learns of it when
 * the close finally arrives, so the call is raced against the stub breaking and a deadline:
 * either way the caller hears back instead of waiting on a call the server never received.
 */
function attempt(stub: RpcStub<Overseer>, call: (stub: RpcStub<Overseer>) => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const broken = new Promise<never>((_, reject) => {
    stub.onRpcBroken?.(error => reject(new ConnectionDropped(error)))
  })
  broken.catch(() => {})  // the stub may break long after this attempt settled
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NoResponse()), RESOLVE_RESPONSE_TIMEOUT_MS)
  })
  let result: Promise<unknown>
  try {
    result = call(stub)
  } catch (error) {
    result = Promise.reject(error)  // a stub already disposed throws synchronously
  }
  return Promise.race([result, broken, deadline]).catch(error => {
    throw classifyRpcError(error) === 'connection' && !(error instanceof ConnectionDropped)
      ? new ConnectionDropped(error) : error
  }).finally(() => clearTimeout(timer))
}

/**
 * Returns `resolveAction` for an action's approve/deny controls, and `creationAccountModal` for
 * the caller to render: approving a creation first asks which account to create it in, and how.
 */
export function useResolveAction(
  overseer: RpcStub<Overseer>,
  setProcessing: Dispatch<SetStateAction<Set<number>>>,
  onResolved?: (actionId: number, state: Extract<ActionState, 'approved' | 'rejected'>) => void,
) {
  const toasts = useKumoToastManager()
  const onResolvedRef = useRef(onResolved)
  onResolvedRef.current = onResolved
  const [creation, setCreation] = useState<ActionLogEntry | null>(null)

  // A reconnect publishes a new overseer through props; a decision the drop interrupted waits
  // here for it, so it can be sent once more on the restored session.
  const overseerRef = useRef(overseer)
  const overseerWaitersRef = useRef(new Set<() => void>())
  useEffect(() => {
    overseerRef.current = overseer
    for (const wake of overseerWaitersRef.current) wake()
  }, [overseer])

  const nextOverseer = useCallback((failed: RpcStub<Overseer>) => {
    if (overseerRef.current !== failed) return Promise.resolve(overseerRef.current)
    return new Promise<RpcStub<Overseer> | null>(resolve => {
      const waiters = overseerWaitersRef.current
      const done = (next: RpcStub<Overseer> | null) => {
        clearTimeout(timer)
        waiters.delete(wake)
        resolve(next)
      }
      const wake = () => { if (overseerRef.current !== failed) done(overseerRef.current) }
      const timer = setTimeout(() => done(null), RESOLVE_RECONNECT_WAIT_MS)
      waiters.add(wake)
    })
  }, [])

  const resolve = useCallback(async (
    actionId: number, decision: ActionDecision, approval?: CreationApproval,
  ) => {
    const call = (stub: RpcStub<Overseer>) => decision === 'approve'
      ? stub.approveAction(actionId, approval)
      : stub.rejectAction(actionId)

    setProcessing(previous => new Set(previous).add(actionId))
    try {
      const first = overseerRef.current
      try {
        await attempt(first, call)
      } catch (error) {
        if (!(error instanceof ConnectionDropped)) throw error
        console.warn(`Connection dropped while trying to ${decision} action ${actionId}; retrying.`,
          error.cause)
        const restored = await nextOverseer(first)
        if (!restored) throw error
        // Deciding is safe to repeat: the server refuses an action that is no longer pending. If
        // it refuses this one, the first attempt (or someone else) already decided it, and the
        // actions subscription brings the card its real state.
        try {
          await attempt(restored, call)
        } catch (retryError) {
          if (messageOf(retryError).includes(NOT_PENDING_MESSAGE)) return
          throw retryError
        }
      }
      onResolvedRef.current?.(actionId, decision === 'approve' ? 'approved' : 'rejected')
    } catch (error) {
      console.error(`Failed to ${decision} action:`, error)
      toasts.add(error instanceof NoResponse
        ? { title: `No answer yet to ${decision} action`, description: error.message, variant: 'error' }
        : {
          title: `Failed to ${decision} action`,
          ...(error instanceof ConnectionDropped ? { description: error.message } : {}),
          variant: 'error',
        })
    } finally {
      setProcessing(previous => {
        const next = new Set(previous)
        next.delete(actionId)
        return next
      })
    }
  }, [nextOverseer, setProcessing, toasts])

  const resolveAction = useCallback(async (action: ActionLogEntry, decision: ActionDecision) => {
    if (decision === 'approve' && action.type === 'action' && action.creation) setCreation(action)
    else await resolve(action.id, decision)
  }, [resolve])

  const creationAccountModal = creation && (
    <CreationAccountModal
      overseer={overseer}
      gatekeeperId={creation.gatekeeperId!}
      onChoose={approval => {
        setCreation(null)
        void resolve(creation.id, 'approve', approval)
      }}
      onCancel={() => setCreation(null)}
    />
  )

  return { resolveAction, creationAccountModal }
}
