// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { notifyWorkspacesChanged, WORKSPACES_CHANGED_EVENT } from './workspaceListBus'

describe('notifyWorkspacesChanged', () => {
  it('dispatches the workspaces-changed event on window', () => {
    const listener = vi.fn<() => void>()
    window.addEventListener(WORKSPACES_CHANGED_EVENT, listener)
    notifyWorkspacesChanged()
    window.removeEventListener(WORKSPACES_CHANGED_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
