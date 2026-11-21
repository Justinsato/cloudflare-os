// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, ConnectedAccountsFilter } from '@gadgets/workshop-shared/api'

const state = vi.hoisted(() => ({ api: null as RpcStub<AuthenticatedApi> | null }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: state.api }) }))
vi.mock('./ServerConfigContext', () => ({ useSiteName: () => 'Cloudflare OS' }))
vi.mock('@cloudflare/kumo', async importOriginal => ({
  ...await importOriginal<typeof import('@cloudflare/kumo')>(),
  useKumoToastManager: () => ({ add: () => {} }),
}))
import { Route } from './routes/gatekeepers'
const GatekeepersPage = Route.options.component!
await GatekeepersPage.preload?.()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  state.api = null
  localStorage.clear()
  vi.unstubAllGlobals()
})

type Subscriber = Parameters<AuthenticatedApi['subscribeConnectedAccounts']>[0]
const vendor = (name: string) => ({ displayName: name, url: `https://${name.toLowerCase()}.example`, tagline: `${name} data` })

// PKM is admin-forced: it only arrives when the subscription asks for forced accounts.
// Notes is an opt-in ambient account the user added, so it arrives on both subscriptions.
const renderPage = async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const filters: (ConnectedAccountsFilter | undefined)[] = []
  state.api = {
    listAddableGatekeepers: async () => [],
    listGatekeeperVendors: async () => [],
    subscribeConnectedAccounts: (subscriber: Subscriber, filter?: ConnectedAccountsFilter) => {
      filters.push(filter)
      if (filter?.includeForcedAutoProvisionedAccounts) {
        subscriber.add(1, { displayName: 'Operator', avatar: { url: '' } }, vendor('PKM'), [], true, 'pkm')
      }
      subscriber.add(2, { displayName: 'Alice', avatar: { url: '' } }, vendor('Notes'), [], true, 'notes')
      subscriber.ready()
      return Object.assign(Promise.resolve(), { [Symbol.dispose]() {} })
    },
    onRpcBroken: () => {},
  } as unknown as RpcStub<AuthenticatedApi>
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<GatekeepersPage />))
  return filters
}
const card = (name: string) => Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"]'))
  .find(element => element.textContent?.includes(name))!
const hasButton = (text: string) => Array.from(document.body.querySelectorAll('button')).some(b => b.textContent === text)

describe('gatekeepers page lists admin-forced gatekeepers', () => {
  it('shows forced gatekeepers marked "On for everyone" next to removable ones', async () => {
    const filters = await renderPage()
    expect(filters).toContainEqual({ includeForcedAutoProvisionedAccounts: true })
    expect(card('PKM').textContent).toContain('On for everyone')
    expect(card('Notes').textContent).not.toContain('On for everyone')
  })

  it('offers Disconnect only for gatekeepers the user can remove', async () => {
    await renderPage()
    await act(async () => card('PKM').click())
    expect(hasButton('Disconnect')).toBe(false)
    await act(async () => root!.unmount())
    root = undefined
    container?.remove()

    await renderPage()
    await act(async () => card('Notes').click())
    expect(hasButton('Disconnect')).toBe(true)
  })
})
